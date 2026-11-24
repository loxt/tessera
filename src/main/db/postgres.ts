import pg from 'pg'
import Cursor from 'pg-cursor'
import type { CellValue, ColumnMeta, FolderKind, PlanNode, TableInfo } from '@shared/model'
import { leadingKeyword } from '@shared/sql'
import { literal, qualified, quoteIdent } from '@shared/dml'
import { connectWithSsl, DbFailure, STREAM_BATCH, toBinary, toDriverParam, txStateAfter, type Adapter, type DbSession, type QueryOutput, type ResolvedProfile, type RowSink } from './types'
import { browse, flag, MAX_COMPLETION_COLUMNS, MAX_COMPLETION_TABLES, records, str, toCompletionFks, toCompletionTables, type Catalog, type CatalogObject, type Row } from './catalog'

const raw = (v: string) => v
const toNum = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : v)
/** Type OIDs that become JS values; everything else stays the server's text (lossless). */
const PARSERS: Record<number, (v: string) => CellValue> = {
  16: (v) => v === 't', // bool
  17: (v) => toBinary(Buffer.from(v.slice(2), 'hex')), // bytea (hex output)
  21: toNum, // int2
  23: toNum, // int4
  26: toNum, // oid
  700: toNum, // float4
  701: toNum // float8
}
const types = { getTypeParser: ((oid: number) => PARSERS[oid] ?? raw) as unknown as pg.CustomTypesConfig['getTypeParser'] }

interface PgError {
  message: string
  code?: string
  position?: string
  detail?: string
  hint?: string
}
const fail = (e: unknown) => {
  if (e instanceof DbFailure) return e
  const err = e as PgError
  return new DbFailure({
    message: err.message,
    code: err.code,
    position: err.position ? Number(err.position) : undefined,
    detail: err.detail,
    hint: err.hint
  })
}

async function connect(p: ResolvedProfile): Promise<pg.Client> {
  return connectWithSsl(p.ssl, p.host, async (ssl) => {
    const client = new pg.Client({
      host: p.host ?? 'localhost',
      port: p.port ?? 5432,
      user: p.user,
      password: p.password,
      database: p.database,
      ssl,
      connectionTimeoutMillis: 10_000,
      application_name: 'Tessera',
      types
    })
    try {
      await client.connect()
      return client
    } catch (e) {
      await client.end().catch(() => {})
      throw e
    }
  })
}

class PgSession implements DbSession {
  readonly engine = 'postgres'
  inTransaction = false
  private typeNames = new Map<string, string>()
  private closed = false

  constructor(
    private client: pg.Client,
    private profile: ResolvedProfile
  ) {}

  private cursor(sql: string, params: CellValue[]) {
    const cursor = this.client.query(new Cursor(sql, params.map(toDriverParam), { rowMode: 'array', types }))
    const read = (n: number) =>
      new Promise<{ rows: CellValue[][]; result: pg.QueryResult }>((resolve, reject) =>
        cursor.read(n, (err, rows, result) => (err ? reject(err) : resolve({ rows, result })))
      )
    return { read, close: () => cursor.close() }
  }

  async query(sql: string, params: CellValue[] = [], limit?: number): Promise<QueryOutput> {
    const cursor = this.cursor(sql, params)
    try {
      const { rows, result } = await cursor.read(limit === undefined ? 0 : limit + 1)
      await cursor.close()
      const columns = await this.columnMeta(result.fields)
      const hasMore = limit !== undefined && rows.length > limit
      return result.fields.length
        ? { returnsRows: true, columns, rows: hasMore ? rows.slice(0, limit) : rows, hasMore }
        : { returnsRows: false, columns: [], rows: [], hasMore: false, affected: result.rowCount ?? 0, command: result.command }
    } catch (e) {
      throw fail(e)
    } finally {
      this.inTransaction = this.trackTx(sql)
    }
  }

  async stream(sql: string, params: CellValue[] = [], onRows: RowSink): Promise<void> {
    const cursor = this.cursor(sql, params)
    try {
      let columns: ColumnMeta[] | undefined
      for (;;) {
        const { rows, result } = await cursor.read(STREAM_BATCH)
        // no format_type lookup: the open cursor holds the connection, and exports only use the names
        columns ??= result.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) }))
        await onRows(rows, columns)
        if (rows.length < STREAM_BATCH) break
      }
    } catch (e) {
      throw fail(e)
    } finally {
      await cursor.close().catch(() => {})
      this.inTransaction = this.trackTx(sql)
    }
  }

  private trackTx(sql: string): boolean {
    const status = this.client.getTransactionStatus()
    return status ? status !== 'I' : txStateAfter(sql, leadingKeyword(sql, 'postgres'), this.inTransaction)
  }

  private async columnMeta(fields: pg.FieldDef[]): Promise<ColumnMeta[]> {
    const key = (f: pg.FieldDef) => `${f.dataTypeID}:${f.dataTypeModifier}`
    const missing = fields.filter((f) => !this.typeNames.has(key(f)))
    if (missing.length) {
      const res = await this.client.query<{ k: string; name: string }>(
        `select t.oid || ':' || t.mod as k, format_type(t.oid, nullif(t.mod, -1)) as name
         from unnest($1::oid[], $2::int[]) as t(oid, mod)`,
        [missing.map((f) => f.dataTypeID), missing.map((f) => f.dataTypeModifier)]
      )
      for (const r of res.rows) this.typeNames.set(r.k, r.name)
    }
    return fields.map((f) => ({ name: f.name, type: this.typeNames.get(key(f)) ?? String(f.dataTypeID) }))
  }

  async cancel(): Promise<void> {
    if (this.closed) return
    const side = await connect(this.profile)
    try {
      await side.query('select pg_cancel_backend($1)', [(this.client as pg.Client & { processID: number }).processID])
    } finally {
      await side.end()
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.client.end().catch(() => {})
  }
}

const SCHEMA_FILTER = `n.nspname !~ '^pg_(toast|temp_)' and ($1 or n.nspname not in ('pg_catalog', 'information_schema'))`

const OBJECT_SQL: Partial<Record<FolderKind, string>> = {
  tables: `select c.relname as name, 'table' as kind, null as detail from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = $1 and c.relkind in ('r', 'p', 'f')`,
  views: `select c.relname as name, 'view' as kind, case c.relkind when 'm' then 'materialized' end as detail
          from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('v', 'm')`,
  routines: `select p.proname as name, 'routine' as kind, '(' || pg_get_function_identity_arguments(p.oid) || ')' as detail
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.prokind in ('f', 'p')`,
  sequences: `select c.relname as name, 'sequence' as kind, null as detail from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = $1 and c.relkind = 'S'`
}

const rel = (schema: string, table: string) => qualified(schema, table, 'postgres')
const json = <T>(v: CellValue): T => JSON.parse(str(v)) as T

const attNames = (arr: string, rel: string) =>
  `to_json(array(select a.attname from unnest(${arr}) with ordinality k(n, i)
     join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n order by k.i))`

function columnRows(s: DbSession, schema: string, table: string): Promise<Row[]> {
  return records(
    s,
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
       pg_get_expr(d.adbin, d.adrelid) as def, a.attidentity as ident, a.attgenerated as gen
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    [rel(schema, table)]
  )
}

async function tableInfo(s: DbSession, schema: string, table: string): Promise<TableInfo> {
  const r = rel(schema, table)
  const [[kind], cols, cons, idx] = await Promise.all([
    records(s, `select relkind from pg_class where oid = $1::regclass`, [r]),
    columnRows(s, schema, table),
    records(
      s,
      `select con.conname as name, con.contype as type, ${attNames('con.conkey', 'con.conrelid')} as cols,
         fn.nspname as ref_schema, fc.relname as ref_table, ${attNames('con.confkey', 'con.confrelid')} as ref_cols
       from pg_constraint con left join pg_class fc on fc.oid = con.confrelid left join pg_namespace fn on fn.oid = fc.relnamespace
       where con.conrelid = $1::regclass and con.contype in ('p', 'f') order by con.conname`,
      [r]
    ),
    records(
      s,
      `select i.relname as name, x.indisunique as uniq, x.indisprimary as prim,
         to_json(array(select coalesce(a.attname, pg_get_indexdef(x.indexrelid, k.i::int, true))
           from unnest(x.indkey::int2[]) with ordinality k(n, i)
           left join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.n
           where k.i <= x.indnkeyatts order by k.i)) as cols
       from pg_index x join pg_class i on i.oid = x.indexrelid where x.indrelid = $1::regclass order by i.relname`,
      [r]
    )
  ])
  const pk = cons.find((c) => c.type === 'p')
  return {
    schema,
    name: table,
    kind: kind?.relkind === 'v' || kind?.relkind === 'm' ? 'view' : 'table',
    columns: cols.map((c) => ({
      name: str(c.name),
      type: str(c.type),
      nullable: flag(c.nullable),
      default: c.def === null ? null : str(c.def),
      autoIncrement: str(c.ident) !== '' || str(c.def).startsWith('nextval(')
    })),
    primaryKey: pk ? json<string[]>(pk.cols) : [],
    foreignKeys: cons
      .filter((c) => c.type === 'f')
      .map((c) => ({
        name: str(c.name),
        columns: json<string[]>(c.cols),
        refSchema: str(c.ref_schema),
        refTable: str(c.ref_table),
        refColumns: json<string[]>(c.ref_cols)
      })),
    indexes: idx.map((i) => ({ name: str(i.name), columns: json<string[]>(i.cols), unique: flag(i.uniq), primary: flag(i.prim) }))
  }
}

const catalog: Catalog = {
  folders: ['tables', 'views', 'routines', 'sequences'],
  async schemas(s, showSystem) {
    const rows = await records(s, `select n.nspname as name from pg_namespace n where ${SCHEMA_FILTER} order by 1`, [showSystem])
    return rows.map((r) => str(r.name))
  },
  async objects(s, schema, folder) {
    const sql = OBJECT_SQL[folder]
    if (!sql) return []
    const rows = await records(s, sql, [schema])
    return rows.map(
      (r): CatalogObject => ({
        kind: str(r.kind) as CatalogObject['kind'],
        name: str(r.name),
        ...(r.detail === null ? {} : { detail: str(r.detail) }),
        ...(r.kind === 'routine' ? { idName: str(r.name) + str(r.detail) } : {})
      })
    )
  },
  tableInfo
}

async function tableDdl(s: DbSession, schema: string, table: string): Promise<string> {
  const r = rel(schema, table)
  const [cols, cons, idx, [comment]] = await Promise.all([
    columnRows(s, schema, table),
    records(
      s,
      `select conname as name, pg_get_constraintdef(oid, true) as def from pg_constraint
       where conrelid = $1::regclass and contype <> 'n'
       order by case contype when 'p' then 0 when 'u' then 1 when 'c' then 2 else 3 end, conname`,
      [r]
    ),
    records(
      s,
      `select pg_get_indexdef(x.indexrelid) as def from pg_index x join pg_class i on i.oid = x.indexrelid
       where x.indrelid = $1::regclass and not exists (select 1 from pg_constraint c where c.conindid = x.indexrelid)
       order by i.relname`,
      [r]
    ),
    records(s, `select obj_description($1::regclass, 'pg_class') as c`, [r])
  ])
  const colLines = cols.map((c) => {
    const ident = c.ident === 'a' ? ' GENERATED ALWAYS AS IDENTITY' : c.ident === 'd' ? ' GENERATED BY DEFAULT AS IDENTITY' : ''
    const def = c.def === null ? '' : c.gen === 's' ? ` GENERATED ALWAYS AS (${str(c.def)}) STORED` : ` DEFAULT ${str(c.def)}`
    return `    ${quoteIdent(str(c.name), 'postgres')} ${str(c.type)}${ident}${flag(c.nullable) ? '' : ' NOT NULL'}${def}`
  })
  const conLines = cons.map((c) => `    CONSTRAINT ${quoteIdent(str(c.name), 'postgres')} ${str(c.def)}`)
  const parts = [`CREATE TABLE ${r} (\n${[...colLines, ...conLines].join(',\n')}\n);`, ...idx.map((i) => `${str(i.def)};`)]
  if (comment?.c != null) parts.push(`COMMENT ON TABLE ${r} IS ${literal(comment.c, 'postgres')};`)
  return parts.join('\n\n')
}

async function ddl(s: DbSession, kind: string, schema: string, name: string): Promise<string> {
  if (kind === 'table') return tableDdl(s, schema, name)
  if (kind === 'view') {
    const [v] = await records(s, `select relkind, pg_get_viewdef(oid, true) as def from pg_class where oid = $1::regclass`, [rel(schema, name)])
    const head = v.relkind === 'm' ? 'CREATE MATERIALIZED VIEW' : 'CREATE VIEW'
    return `${head} ${rel(schema, name)} AS\n${str(v.def).trim().replace(/;$/, '')};`
  }
  if (kind === 'routine') {
    const rows = await records(
      s,
      `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and p.proname = $2 and p.prokind in ('f', 'p') order by p.oid`,
      [schema, name]
    )
    return rows.map((r) => `${str(r.def).trim()};`).join('\n\n')
  }
  if (kind === 'sequence') {
    const [q] = await records(s, `select * from pg_sequences where schemaname = $1 and sequencename = $2`, [schema, name])
    if (!q) throw new DbFailure({ message: `Sequence ${schema}.${name} not found` })
    return (
      `CREATE SEQUENCE ${rel(schema, name)} AS ${str(q.data_type)} INCREMENT BY ${str(q.increment_by)}` +
      ` MINVALUE ${str(q.min_value)} MAXVALUE ${str(q.max_value)} START WITH ${str(q.start_value)}` +
      ` CACHE ${str(q.cache_size)}${flag(q.cycle) ? ' CYCLE' : ' NO CYCLE'};`
    )
  }
  throw new DbFailure({ message: `DDL not supported for ${kind}` })
}

interface PgPlan {
  'Node Type': string
  'Relation Name'?: string
  Alias?: string
  'Index Name'?: string
  'Total Cost'?: number
  'Plan Rows'?: number
  'Actual Rows'?: number
  'Actual Total Time'?: number
  Plans?: PgPlan[]
  [k: string]: unknown
}
const PLAN_DETAIL = ['Index Cond', 'Recheck Cond', 'Filter', 'Hash Cond', 'Merge Cond', 'Join Filter', 'Sort Key', 'Group Key']

function planNode(p: PgPlan): PlanNode {
  let label = p['Node Type']
  if (p['Index Name']) label += ` using ${p['Index Name']}`
  if (p['Relation Name']) label += ` on ${p['Relation Name']}${p.Alias && p.Alias !== p['Relation Name'] ? ` ${p.Alias}` : ''}`
  const detail = PLAN_DETAIL.filter((k) => p[k] !== undefined)
    .map((k) => `${k}: ${Array.isArray(p[k]) ? (p[k] as string[]).join(', ') : String(p[k])}`)
    .join('; ')
  return {
    label,
    ...(detail ? { detail } : {}),
    cost: p['Total Cost'],
    rows: p['Actual Rows'] ?? p['Plan Rows'],
    time: p['Actual Total Time'],
    children: (p.Plans ?? []).map(planNode)
  }
}

async function explain(s: DbSession, sql: string, analyze: boolean): Promise<PlanNode[]> {
  const wrap = analyze && !s.inTransaction
  if (wrap) await s.query('BEGIN')
  try {
    const out = await s.query(`EXPLAIN (FORMAT JSON${analyze ? ', ANALYZE, BUFFERS' : ''}) ${sql}`)
    const plans = JSON.parse(str(out.rows[0]?.[0] ?? '[]')) as { Plan: PgPlan }[]
    return plans.map((p) => planNode(p.Plan))
  } finally {
    if (wrap) await s.query('ROLLBACK')
  }
}

export const postgres: Adapter = {
  engine: 'postgres',
  async open(profile) {
    try {
      const client = await connect(profile)
      client.on('error', () => {}) // connection loss surfaces on the next query
      if (profile.readOnly) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
      return new PgSession(client, profile)
    } catch (e) {
      throw fail(e)
    }
  },
  async serverVersion(s) {
    const out = await s.query('show server_version')
    return `PostgreSQL ${str(out.rows[0][0]).split(' ')[0]}`
  },
  beginSql: 'BEGIN',
  setSchemaSql: (schema) => `SET search_path TO ${quoteIdent(schema, 'postgres')}`,
  listChildren: (s, path, showSystem) => browse(catalog, s, path, showSystem),
  tableInfo,
  ddl,
  async metadata(s, showSystem, hidden = []) {
    // partitions (DataGrip hides them too) and hidden schemas would eat MAX_COMPLETION_* before
    // the schemas people actually query, which sort later alphabetically
    const filter = `${SCHEMA_FILTER} and n.nspname not in (select json_array_elements_text($2::json))`
    const hiddenJson = JSON.stringify(hidden)
    const [[cur], schemas, tables, columns, fks] = await Promise.all([
      records(s, 'select current_schema() as s'),
      catalog.schemas(s, showSystem),
      records(
        s,
        `select n.nspname as schema, c.relname as name, c.relkind in ('v', 'm') as is_view
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r', 'p', 'f', 'v', 'm') and not c.relispartition and ${filter}
         order by n.nspname, c.relname limit ${MAX_COMPLETION_TABLES}`,
        [showSystem, hiddenJson]
      ),
      records(
        s,
        `select n.nspname as schema, c.relname as name, a.attname as col
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
         where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'f', 'v', 'm') and not c.relispartition and ${filter}
         order by n.nspname, c.relname, a.attnum limit ${MAX_COMPLETION_COLUMNS}`,
        [showSystem, hiddenJson]
      ),
      records(
        s,
        `select con.oid::text as id, n.nspname as schema, c.relname as name, rn.nspname as ref_schema, rc.relname as ref_name,
                a.attname as col, ra.attname as ref_col, k.i as pos
         from pg_constraint con
         cross join lateral unnest(con.conkey, con.confkey) with ordinality as k(attnum, ref_attnum, i)
         join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
         join pg_class rc on rc.oid = con.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
         join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = k.ref_attnum
         where con.contype = 'f' and ${filter}
         order by con.oid, k.i limit ${MAX_COMPLETION_COLUMNS}`,
        [showSystem, hiddenJson]
      )
    ])
    return { defaultSchema: str(cur?.s) || 'public', schemas, tables: toCompletionTables(tables, columns), foreignKeys: toCompletionFks(fks) }
  },
  explain
}

