import { Worker } from 'node:worker_threads'
import type { CellValue, FolderKind, PlanNode, TableInfo } from '@shared/model'
import { quoteIdent } from '@shared/dml'
import { DbFailure, STREAM_BATCH, toDriverParam, type Adapter, type DbSession, type QueryOutput, type RowSink } from './types'
import { browse, flag, groupBy, MAX_COMPLETION_COLUMNS, MAX_COMPLETION_TABLES, records, str, toCompletionFks, toCompletionTables, treeFromDepths, type Catalog, type CatalogObject } from './catalog'
import { createSqliteHandler, toDbError, type SqliteRequest, type SqliteResponse, type WorkerInit, type WorkerMessage } from './sqlite-worker'

const RESET = 'Query cancelled (SQLite session was reset)'

interface Backend {
  call(req: SqliteRequest): Promise<SqliteResponse>
  /** abort the running statement, if any */
  cancel(): Promise<void>
  close(): Promise<void>
}

// ponytail: running from source (vitest) has no compiled worker, so queries run in-process and cancel is a no-op there.
function inProcessBackend(init: WorkerInit): Backend {
  let handler: ReturnType<typeof createSqliteHandler>
  try {
    handler = createSqliteHandler(init.file, init.readOnly)
  } catch (e) {
    throw new DbFailure(toDbError(e))
  }
  return { call: async (req) => handler.handle(req), cancel: async () => {}, close: async () => void handler.close() }
}

/** Runs SQLite in a worker thread so a runaway statement can be terminated; the worker is re-created on demand. */
function workerBackend(init: WorkerInit): Backend {
  let worker: Worker | undefined
  let nextId = 1
  const pending = new Map<number, { resolve(r: SqliteResponse): void; reject(e: unknown): void }>()
  const rejectAll = (message: string) => {
    for (const p of pending.values()) p.reject(new DbFailure({ message }))
    pending.clear()
  }
  const spawn = () => {
    const w = new Worker(new URL('./sqlite-worker.js', import.meta.url), { workerData: init })
    w.on('message', ({ id, ...res }: { id: number } & SqliteResponse) => {
      pending.get(id)?.resolve(res)
      pending.delete(id)
    })
    // a discarded worker exiting later must not touch the replacement's requests
    w.on('error', (e) => worker === w && rejectAll(e.message))
    w.on('exit', () => {
      if (worker !== w) return
      worker = undefined
      rejectAll(RESET)
    })
    return w
  }
  const send = (msg: Omit<WorkerMessage, 'id'>) =>
    new Promise<SqliteResponse>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ;(worker ??= spawn()).postMessage({ ...msg, id })
    })
  const cancel = async () => {
    if (!worker || pending.size === 0) return
    const w = worker
    worker = undefined
    rejectAll(RESET)
    // ponytail: terminate() can't preempt a native sqlite3_step, so the old thread only exits once the current
    // step returns (an endless statement keeps spinning until app exit). Upgrade: utilityProcess + kill, or
    // sqlite3_interrupt if node:sqlite ever exposes it. Not awaited so cancel never hangs.
    void w.terminate()
    w.unref()
  }
  return {
    call: (req) => send({ req }),
    cancel,
    async close() {
      if (pending.size) return cancel()
      const w = worker
      if (!w) return
      await send({ close: true }).catch(() => {})
      worker = undefined
      await w.terminate()
    }
  }
}

class SqliteSession implements DbSession {
  readonly engine = 'sqlite'
  inTransaction = false
  private closed = false

  constructor(private backend: Backend) {}

  private nextCursor = 1

  private async call(req: SqliteRequest): Promise<QueryOutput> {
    if (this.closed) throw new DbFailure({ message: 'Session is closed' })
    const res = await this.backend.call(req).catch((e) => {
      this.inTransaction = false
      throw e
    })
    this.inTransaction = res.inTransaction
    if ('error' in res) throw new DbFailure(res.error)
    return res.ok
  }

  query(sql: string, params: CellValue[] = [], limit?: number): Promise<QueryOutput> {
    return this.call({ sql, params: params.map(toDriverParam), limit })
  }

  async stream(sql: string, params: CellValue[] = [], onRows: RowSink): Promise<void> {
    const cursor = { id: this.nextCursor++, take: STREAM_BATCH }
    const args = params.map(toDriverParam)
    for (let open = true; open; ) {
      // a failed page already dropped its cursor (or the whole worker, on cancel)
      const out = await this.call({ sql, params: args, cursor })
      open = out.hasMore
      try {
        await onRows(out.rows, out.columns)
      } catch (e) {
        // the sink gave up mid-way: release the statement
        if (open) await this.call({ sql, params: [], cursor: { ...cursor, take: 0 } }).catch(() => {})
        throw e
      }
    }
  }

  cancel = () => this.backend.cancel()

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.backend.close()
  }
}

const q = (name: string) => quoteIdent(name, 'sqlite')

const catalog: Catalog = {
  folders: ['tables', 'views'],
  async schemas(s) {
    const rows = await records(s, 'select name from pragma_database_list where name <> ? order by seq', ['temp'])
    return rows.map((r) => str(r.name))
  },
  async objects(s, schema, folder: FolderKind, showSystem) {
    const type = folder === 'tables' ? 'table' : folder === 'views' ? 'view' : null
    if (!type) return []
    const rows = await records(
      s,
      `select name from ${q(schema)}.sqlite_master where type = ? and (? or name not like 'sqlite\\_%' escape '\\') order by name`,
      [type, showSystem]
    )
    return rows.map((r): CatalogObject => ({ kind: type, name: str(r.name) }))
  },
  tableInfo
}

async function tableInfo(s: DbSession, schema: string, table: string): Promise<TableInfo> {
  const args = [table, schema]
  const [[t], cols, idx, fks] = await Promise.all([
    records(s, 'select type, wr from pragma_table_list(?) where schema = ?', args),
    records(s, 'select name, type, "notnull" as nn, dflt_value as def, pk from pragma_table_info(?, ?) order by cid', args),
    records(
      s,
      `select il.name, il."unique" as uniq, il.origin, coalesce(ii.name, '<expr>') as col
       from pragma_index_list(?1, ?2) il join pragma_index_info(il.name, ?2) ii order by il.name, ii.seqno`,
      args
    ),
    records(s, 'select id, "table" as ref, "from" as col, "to" as ref_col from pragma_foreign_key_list(?, ?) order by id, seq', args)
  ])
  if (!t) throw new DbFailure({ message: `Table ${schema}.${table} not found` })
  const isView = t.type === 'view'
  const primaryKey = cols
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => str(c.name))
  const rowidAlias = !flag(t.wr) && primaryKey.length === 1 && cols.some((c) => str(c.name) === primaryKey[0] && str(c.type).toUpperCase() === 'INTEGER')
  const foreignKeys = await Promise.all(
    [...groupBy(fks, (r) => str(r.id)).values()].map(async (rs) => {
      const refTable = str(rs[0].ref)
      // "to" is NULL when the FK targets the parent's primary key implicitly
      const refColumns = rs.some((r) => r.ref_col === null) ? (await tableInfo(s, schema, refTable)).primaryKey : rs.map((r) => str(r.ref_col))
      const columns = rs.map((r) => str(r.col))
      return { name: `fk_${table}_${columns.join('_')}`, columns, refSchema: schema, refTable, refColumns }
    })
  )
  return {
    schema,
    name: table,
    kind: isView ? 'view' : 'table',
    columns: cols.map((c) => ({
      name: str(c.name),
      type: str(c.type),
      nullable: !flag(c.nn),
      default: c.def === null ? null : str(c.def),
      autoIncrement: rowidAlias && str(c.name) === primaryKey[0]
    })),
    primaryKey,
    foreignKeys,
    indexes: [...groupBy(idx, (r) => str(r.name)).entries()].map(([name, rs]) => ({
      name,
      columns: rs.map((r) => str(r.col)),
      unique: flag(rs[0].uniq),
      primary: rs[0].origin === 'pk'
    })),
    ...(!isView && primaryKey.length === 0 && !flag(t.wr) ? { rowid: true } : {})
  }
}

async function ddl(s: DbSession, kind: string, schema: string, name: string): Promise<string> {
  if (kind !== 'table' && kind !== 'view') throw new DbFailure({ message: `DDL not supported for ${kind}` })
  const master = `${q(schema)}.sqlite_master`
  const [main] = await records(s, `select sql from ${master} where name = ? and type = ?`, [name, kind])
  if (!main) throw new DbFailure({ message: `${kind} ${schema}.${name} not found` })
  const extra = await records(s, `select sql from ${master} where tbl_name = ? and type in ('index', 'trigger') and sql is not null order by type, name`, [name])
  return [main, ...extra].map((r) => `${str(r.sql).trim().replace(/;$/, '')};`).join('\n\n')
}

async function explain(s: DbSession, sql: string): Promise<PlanNode[]> {
  const out = await s.query(`EXPLAIN QUERY PLAN ${sql}`)
  const byId = new Map<number, { depth: number; node: PlanNode }>()
  const items = out.rows.map((r) => {
    const depth = (byId.get(Number(r[1]))?.depth ?? -1) + 1
    const item = { depth, node: { label: str(r[3]), children: [] } }
    byId.set(Number(r[0]), item)
    return item
  })
  return treeFromDepths(items)
}

export const sqlite: Adapter = {
  engine: 'sqlite',
  async open(profile) {
    if (!profile.file) throw new DbFailure({ message: 'SQLite connection needs a database file' })
    const init: WorkerInit = { file: profile.file, readOnly: !!profile.readOnly }
    const session = new SqliteSession(import.meta.url.endsWith('.js') ? workerBackend(init) : inProcessBackend(init))
    try {
      await session.query('select 1') // surfaces open errors from the worker
    } catch (e) {
      await session.close()
      throw e
    }
    return session
  },
  async serverVersion(s) {
    const out = await s.query('select sqlite_version()')
    return `SQLite ${str(out.rows[0][0])}`
  },
  beginSql: 'BEGIN',
  setSchemaSql: () => null,
  listChildren: (s, path, showSystem) => browse(catalog, s, path, showSystem),
  tableInfo,
  ddl,
  async metadata(s, showSystem) {
    const schemas = await catalog.schemas(s, showSystem)
    const perSchema = await Promise.all(
      schemas.map((schema) =>
        Promise.all([
          records(
            s,
            `select ? as schema, m.name, m.type = 'view' as is_view from ${q(schema)}.sqlite_master m
             where m.type in ('table', 'view') and (? or m.name not like 'sqlite\\_%' escape '\\')
             order by m.name limit ${MAX_COMPLETION_TABLES}`,
            [schema, showSystem]
          ),
          records(
            s,
            `select ? as schema, m.name, p.name as col from ${q(schema)}.sqlite_master m join pragma_table_info(m.name, ?) p
             where m.type in ('table', 'view') and (? or m.name not like 'sqlite\\_%' escape '\\')
             order by m.name, p.cid limit ${MAX_COMPLETION_COLUMNS}`,
            [schema, schema, showSystem]
          ),
          records(
            s,
            `select ? || '.' || m.name || '.' || f.id as id, ? as schema, m.name, ? as ref_schema, f."table" as ref_name,
                    f."from" as col, f."to" as ref_col, f.seq as pos
             from ${q(schema)}.sqlite_master m join pragma_foreign_key_list(m.name, ?) f
             where m.type = 'table'
             order by m.name, f.id, f.seq limit ${MAX_COMPLETION_COLUMNS}`,
            [schema, schema, schema, schema]
          )
        ])
      )
    )
    const tables = perSchema.flatMap(([t]) => t).slice(0, MAX_COMPLETION_TABLES)
    const columns = perSchema.flatMap(([, c]) => c).slice(0, MAX_COMPLETION_COLUMNS)
    const fks = perSchema.flatMap(([, , f]) => f).slice(0, MAX_COMPLETION_COLUMNS)
    return { defaultSchema: 'main', schemas, tables: toCompletionTables(tables, columns), foreignKeys: toCompletionFks(fks) }
  },
  explain
}
