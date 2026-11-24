import mysql2, { type FieldPacket, type ResultSetHeader, type TypeCast } from 'mysql2/promise'
import type { CellValue, ColumnMeta, FolderKind, PlanNode, TableInfo } from '@shared/model'
import type { Connection as CoreConnection } from 'mysql2'
import { leadingKeyword } from '@shared/sql'
import { qualified, quoteIdent } from '@shared/dml'
import { connectWithSsl, DbFailure, STREAM_BATCH, toBinary, toDriverParam, txStateAfter, type Adapter, type DbSession, type QueryOutput, type ResolvedProfile, type RowSink } from './types'
import { browse, groupBy, MAX_COMPLETION_COLUMNS, MAX_COMPLETION_TABLES, records, str, toCompletionFks, toCompletionTables, treeFromDepths, type Catalog, type CatalogObject } from './catalog'

const TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE', 6: 'NULL', 7: 'TIMESTAMP',
  8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME', 12: 'DATETIME', 13: 'YEAR', 15: 'VARCHAR', 16: 'BIT',
  242: 'VECTOR', 245: 'JSON', 246: 'DECIMAL', 247: 'ENUM', 248: 'SET', 249: 'TINYBLOB', 250: 'MEDIUMBLOB',
  251: 'LONGBLOB', 252: 'BLOB', 253: 'VARCHAR', 254: 'CHAR', 255: 'GEOMETRY'
}
const BINARY_CHARSET = 63
const TEXTUAL: Record<string, string> = { BLOB: 'TEXT', TINYBLOB: 'TINYTEXT', MEDIUMBLOB: 'MEDIUMTEXT', LONGBLOB: 'LONGTEXT' }
const BINARY: Record<string, string> = { VARCHAR: 'VARBINARY', CHAR: 'BINARY' }
const FLAG_UNSIGNED = 32
const FLAG_ENUM = 256
const FLAG_SET = 2048

function typeName(f: FieldPacket): string {
  const flags = typeof f.flags === 'number' ? f.flags : 0
  if (flags & FLAG_ENUM) return 'ENUM'
  if (flags & FLAG_SET) return 'SET'
  const base = TYPE_NAMES[f.columnType ?? f.type ?? -1] ?? 'UNKNOWN'
  const binary = f.characterSet === BINARY_CHARSET
  const name = binary ? (BINARY[base] ?? base) : (TEXTUAL[base] ?? base)
  return flags & FLAG_UNSIGNED ? `${name} UNSIGNED` : name
}

/** Geometry/vector arrive as raw bytes instead of parsed JS objects; JSON stays text via jsonStrings. */
const typeCast: TypeCast = (field, next) => (field.type === 'GEOMETRY' || field.type === 'VECTOR' ? field.buffer() : next())

const cell = (v: unknown): CellValue => (v instanceof Uint8Array ? toBinary(v) : (v as CellValue))

interface MyError {
  message: string
  code?: string
  sqlMessage?: string
  sqlState?: string
}
const fail = (e: unknown) => {
  if (e instanceof DbFailure) return e
  const err = e as MyError
  return new DbFailure({ message: err.sqlMessage ?? err.message, code: err.code, ...(err.sqlState ? { detail: `SQLSTATE ${err.sqlState}` } : {}) })
}

async function connect(p: ResolvedProfile): Promise<mysql2.Connection> {
  return connectWithSsl(p.ssl, p.host, (ssl) =>
    mysql2.createConnection({
      host: p.host ?? 'localhost',
      port: p.port ?? 3306,
      user: p.user,
      password: p.password,
      database: p.database || undefined,
      ssl: ssl || undefined,
      connectTimeout: 10_000,
      multipleStatements: false,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      jsonStrings: true,
      typeCast
    })
  )
}

const IMPLICIT_COMMIT = new Set(['CREATE', 'ALTER', 'DROP', 'RENAME', 'TRUNCATE', 'LOCK', 'UNLOCK', 'GRANT', 'REVOKE', 'ANALYZE', 'OPTIMIZE', 'REPAIR'])

/** Statements subject to SQL_SELECT_LIMIT. */
const SELECTS = new Set(['SELECT', 'WITH', 'TABLE', 'VALUES', '('])

class MySession implements DbSession {
  readonly engine = 'mysql'
  inTransaction = false
  /** SQL_SELECT_LIMIT currently set on the server (null = DEFAULT, undefined = unknown) */
  private selectLimit: number | null | undefined = null
  private closed = false

  constructor(
    private conn: mysql2.Connection,
    private profile: ResolvedProfile
  ) {}

  async query(sql: string, params: CellValue[] = [], limit?: number): Promise<QueryOutput> {
    const kw = leadingKeyword(sql, 'mysql') || (sql.trimStart().startsWith('(') ? '(' : '')
    try {
      // like JDBC setMaxRows: the server stops after limit+1 rows; reset for everything else
      await this.setSelectLimit(SELECTS.has(kw) && limit !== undefined ? limit + 1 : null)
      if (kw === 'SET') this.selectLimit = undefined
      const values = params.length ? params.map(toDriverParam) : undefined
      const [result, fields] = await this.conn.query({ sql, values, rowsAsArray: true })
      // MySQL commits implicitly before/after DDL and locking statements
      this.inTransaction = IMPLICIT_COMMIT.has(kw) ? false : txStateAfter(sql, kw, this.inTransaction)
      return toOutput(result, fields as FieldPacket[] | FieldPacket[][] | undefined, kw, limit)
    } catch (e) {
      throw fail(e)
    }
  }

  async stream(sql: string, params: CellValue[] = [], onRows: RowSink): Promise<void> {
    const kw = leadingKeyword(sql, 'mysql')
    await this.setSelectLimit(null).catch((e) => Promise.reject(fail(e)))
    // the promise wrapper keeps the callback connection at .connection (untyped)
    const core = (this.conn as unknown as { connection: CoreConnection }).connection
    const q = core.query({ sql, values: params.length ? params.map(toDriverParam) : undefined, rowsAsArray: true })
    let columns: ColumnMeta[] = []
    let ended = false
    q.on('fields', (f: FieldPacket[]) => (columns = f.map((x) => ({ name: x.name, type: typeName(x) }))))
    q.on('end', () => (ended = true))
    try {
      let batch: CellValue[][] = []
      // the stream pauses the socket while a batch is being written (backpressure)
      for await (const row of q.stream({ highWaterMark: STREAM_BATCH })) {
        batch.push((row as unknown[]).map(cell))
        if (batch.length === STREAM_BATCH) {
          await onRows(batch, columns)
          batch = []
        }
      }
      await onRows(batch, columns)
      this.inTransaction = IMPLICIT_COMMIT.has(kw) ? false : txStateAfter(sql, kw, this.inTransaction)
    } catch (e) {
      if (!ended) {
        // the sink gave up mid-way: stop the server side and drain, so the connection stays usable
        await this.cancel().catch(() => {})
        core.resume()
        await new Promise((resolve) => (ended ? resolve(null) : q.once('end', resolve)))
      }
      throw fail(e)
    }
  }

  private async setSelectLimit(n: number | null) {
    if (this.selectLimit === n) return
    await this.conn.query(`SET SQL_SELECT_LIMIT = ${n ?? 'DEFAULT'}`)
    this.selectLimit = n
  }

  async cancel(): Promise<void> {
    if (this.closed) return
    const side = await connect(this.profile)
    try {
      await side.query(`KILL QUERY ${this.conn.threadId}`)
    } finally {
      await side.end()
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.conn.end().catch(() => this.conn.destroy())
  }
}

function toOutput(result: unknown, fields: FieldPacket[] | FieldPacket[][] | undefined, kw: string, limit?: number): QueryOutput {
  // CALL returns [rows…, header]: show its first result set
  const multi = Array.isArray(fields) && Array.isArray(fields[0])
  const rows = (multi ? (result as unknown[]).find(Array.isArray) : result) as unknown[][] | ResultSetHeader
  const meta = (multi ? (fields as FieldPacket[][])[0] : fields) as FieldPacket[] | undefined
  if (!Array.isArray(rows) || !meta) {
    const header = (Array.isArray(result) ? result.find((r) => !Array.isArray(r)) : result) as ResultSetHeader | undefined
    return { returnsRows: false, columns: [], rows: [], hasMore: false, affected: header?.affectedRows ?? 0, command: kw }
  }
  const columns: ColumnMeta[] = meta.map((f) => ({ name: f.name, type: typeName(f) }))
  const hasMore = limit !== undefined && rows.length > limit
  const kept = hasMore ? rows.slice(0, limit) : rows
  return { returnsRows: true, columns, rows: kept.map((r) => r.map(cell)), hasMore }
}

const SYSTEM_SCHEMAS = `('mysql', 'sys', 'performance_schema', 'information_schema')`

const OBJECT_SQL: Partial<Record<FolderKind, string>> = {
  tables: `select table_name as name, 'table' as kind, null as detail from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'`,
  views: `select table_name as name, 'view' as kind, null as detail from information_schema.tables where table_schema = ? and table_type = 'VIEW'`,
  routines: `select r.routine_name as name, 'routine' as kind,
    concat('(', coalesce((select group_concat(concat_ws(' ', p.parameter_mode, p.parameter_name, p.dtd_identifier)
      order by p.ordinal_position separator ', ') from information_schema.parameters p
      where p.specific_schema = r.routine_schema and p.specific_name = r.specific_name and p.ordinal_position > 0), ''), ')') as detail
    from information_schema.routines r where r.routine_schema = ?`
}

async function tableInfo(s: DbSession, schema: string, table: string): Promise<TableInfo> {
  const args = [schema, table]
  const [[t], cols, idx, fks] = await Promise.all([
    records(s, `select table_type as type from information_schema.tables where table_schema = ? and table_name = ?`, args),
    records(
      s,
      `select column_name as name, column_type as type, is_nullable as nullable, column_default as def, extra as extra
       from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position`,
      args
    ),
    records(
      s,
      `select index_name as name, non_unique as non_unique, coalesce(column_name, expression) as col
       from information_schema.statistics where table_schema = ? and table_name = ? order by index_name = 'PRIMARY' desc, index_name, seq_in_index`,
      args
    ),
    records(
      s,
      `select constraint_name as name, column_name as col, referenced_table_schema as ref_schema,
         referenced_table_name as ref_table, referenced_column_name as ref_col
       from information_schema.key_column_usage where table_schema = ? and table_name = ? and referenced_table_name is not null
       order by constraint_name, ordinal_position`,
      args
    )
  ])
  if (!t) throw new DbFailure({ message: `Table ${schema}.${table} not found` })
  const indexes = [...groupBy(idx, (r) => str(r.name)).entries()].map(([name, rs]) => ({
    name,
    columns: rs.map((r) => str(r.col)),
    unique: str(rs[0].non_unique) === '0',
    primary: name === 'PRIMARY'
  }))
  return {
    schema,
    name: table,
    kind: t.type === 'VIEW' ? 'view' : 'table',
    columns: cols.map((c) => ({
      name: str(c.name),
      type: str(c.type),
      nullable: c.nullable === 'YES',
      default: c.def === null ? null : str(c.def),
      autoIncrement: str(c.extra).includes('auto_increment')
    })),
    primaryKey: indexes.find((i) => i.primary)?.columns ?? [],
    foreignKeys: [...groupBy(fks, (r) => str(r.name)).entries()].map(([name, rs]) => ({
      name,
      columns: rs.map((r) => str(r.col)),
      refSchema: str(rs[0].ref_schema),
      refTable: str(rs[0].ref_table),
      refColumns: rs.map((r) => str(r.ref_col))
    })),
    indexes
  }
}

const catalog: Catalog = {
  folders: ['tables', 'views', 'routines'],
  async schemas(s, showSystem) {
    const rows = await records(
      s,
      `select schema_name as name from information_schema.schemata where ? or schema_name not in ${SYSTEM_SCHEMAS} order by 1`,
      [showSystem]
    )
    return rows.map((r) => str(r.name))
  },
  async objects(s, schema, folder) {
    const sql = OBJECT_SQL[folder]
    if (!sql) return []
    const rows = await records(s, sql, [schema])
    return rows.map((r): CatalogObject => ({ kind: str(r.kind) as CatalogObject['kind'], name: str(r.name), ...(r.detail === null ? {} : { detail: str(r.detail) }) }))
  },
  tableInfo
}

async function ddl(s: DbSession, kind: string, schema: string, name: string): Promise<string> {
  const target = qualified(schema, name, 'mysql')
  let sql: string
  if (kind === 'table' || kind === 'view') sql = `SHOW CREATE ${kind === 'view' ? 'VIEW' : 'TABLE'} ${target}`
  else if (kind === 'routine') {
    const [r] = await records(s, `select routine_type as t from information_schema.routines where routine_schema = ? and routine_name = ?`, [schema, name])
    if (!r) throw new DbFailure({ message: `Routine ${schema}.${name} not found` })
    sql = `SHOW CREATE ${str(r.t) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE'} ${target}`
  } else throw new DbFailure({ message: `DDL not supported for ${kind}` })
  const out = await s.query(sql)
  const col = out.columns.findIndex((c) => /^Create (Table|View|Procedure|Function)$/.test(c.name))
  const text = str(out.rows[0]?.[col])
  if (!text) throw new DbFailure({ message: `No permission to read the definition of ${schema}.${name}` })
  return `${text.trim().replace(/;$/, '')};`
}

/** Parses `EXPLAIN FORMAT=TREE` / `EXPLAIN ANALYZE` output ("-> " lines indented 4 spaces per level). */
export function parseTreePlan(text: string): PlanNode[] {
  const items: { depth: number; node: PlanNode }[] = []
  for (const line of text.split('\n')) {
    const m = /^(\s*)-> (.*)$/.exec(line)
    if (!m) {
      const last = items[items.length - 1]
      if (last && line.trim()) last.node.detail = [last.node.detail, line.trim()].filter(Boolean).join(' ')
      continue
    }
    const body = m[2]
    const cut = body.search(/ {1,2}\((cost|actual|rows)[ =]/)
    const label = cut < 0 ? body : body.slice(0, cut)
    const detail = cut < 0 ? undefined : body.slice(cut).trim()
    const num = (re: RegExp) => {
      const v = re.exec(body)?.[1]
      return v === undefined ? undefined : Number(v)
    }
    items.push({
      depth: m[1].length / 4,
      node: {
        label,
        ...(detail ? { detail } : {}),
        cost: num(/cost=([\d.e+]+)/),
        rows: num(/actual time=[\d.]+\.\.[\d.]+ rows=([\d.e+]+)/) ?? num(/rows=([\d.e+]+)/),
        time: num(/actual time=[\d.]+\.\.([\d.]+)/),
        children: []
      }
    })
  }
  return treeFromDepths(items)
}

export const mysql: Adapter = {
  engine: 'mysql',
  async open(profile) {
    try {
      const conn = await connect(profile)
      conn.on('error', () => {}) // connection loss surfaces on the next query
      if (profile.readOnly) await conn.query('SET SESSION TRANSACTION READ ONLY')
      return new MySession(conn, profile)
    } catch (e) {
      throw fail(e)
    }
  },
  async serverVersion(s) {
    const out = await s.query('select version()')
    return `MySQL ${str(out.rows[0][0]).split('-')[0]}`
  },
  beginSql: 'START TRANSACTION',
  setSchemaSql: (schema) => `USE ${quoteIdent(schema, 'mysql')}`,
  listChildren: (s, path, showSystem) => browse(catalog, s, path, showSystem),
  tableInfo,
  ddl,
  async metadata(s, showSystem, hidden = []) {
    const notHidden = hidden.length ? ` and table_schema not in (${hidden.map(() => '?').join(', ')})` : ''
    const [[cur], schemas, tables, columns, fks] = await Promise.all([
      records(s, 'select database() as s'),
      catalog.schemas(s, showSystem),
      records(
        s,
        `select table_schema as \`schema\`, table_name as name, table_type = 'VIEW' as is_view
         from information_schema.tables
         where (? or table_schema not in ${SYSTEM_SCHEMAS})${notHidden}
         order by table_schema, table_name limit ${MAX_COMPLETION_TABLES}`,
        [showSystem, ...hidden]
      ),
      records(
        s,
        `select table_schema as \`schema\`, table_name as name, column_name as col
         from information_schema.columns
         where (? or table_schema not in ${SYSTEM_SCHEMAS})${notHidden}
         order by table_schema, table_name, ordinal_position limit ${MAX_COMPLETION_COLUMNS}`,
        [showSystem, ...hidden]
      ),
      records(
        s,
        `select concat(table_schema, '.', table_name, '.', constraint_name) as id, table_schema as \`schema\`, table_name as name,
                referenced_table_schema as ref_schema, referenced_table_name as ref_name, column_name as col,
                referenced_column_name as ref_col, ordinal_position as pos
         from information_schema.key_column_usage
         where referenced_table_name is not null and (? or table_schema not in ${SYSTEM_SCHEMAS})${notHidden}
         order by table_schema, table_name, constraint_name, ordinal_position limit ${MAX_COMPLETION_COLUMNS}`,
        [showSystem, ...hidden]
      )
    ])
    return { defaultSchema: str(cur?.s) || schemas[0] || '', schemas, tables: toCompletionTables(tables, columns), foreignKeys: toCompletionFks(fks) }
  },
  async explain(s, sql, analyze) {
    const wrap = analyze && !s.inTransaction
    if (wrap) await s.query('START TRANSACTION')
    try {
      const out = await s.query(analyze ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN FORMAT=TREE ${sql}`)
      return parseTreePlan(str(out.rows[0]?.[0]))
    } finally {
      if (wrap) await s.query('ROLLBACK')
    }
  }
}
