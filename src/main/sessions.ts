import { generateDml, inlineParams, qualified, type ChangeSet } from '@shared/dml'
import type {
  CellValue,
  DbError,
  Engine,
  ExecOptions,
  ExecResult,
  PlanNode,
  TableInfo,
  TableQuery,
  TestResult
} from '@shared/model'
import { leadingKeyword } from '@shared/sql'
import { adapterFor } from './db/registry'
import { DbFailure, type Adapter, type DbSession, type QueryOutput, type ResolvedProfile, type RowSink } from './db/types'

interface Entry {
  connectionId: string
  adapter: Adapter
  session: DbSession
  autoCommit: boolean
  schema?: string
  /** serializes work on one physical connection */
  lock: Promise<unknown>
}

const TX_CONTROL = new Set(['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'END', 'ABORT', 'SAVEPOINT', 'RELEASE', 'SET'])

const LOST_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', '57P01', '57P02', '57P03'])

/** Errors after which the physical connection is unusable and must be reopened. */
export function isConnectionLost(err: unknown): boolean {
  const e = toDbError(err)
  return (!!e.code && (LOST_CODES.has(e.code) || e.code.startsWith('08'))) || /connection (terminated|lost|is closed)|not queryable|closed state/i.test(e.message)
}

export function toDbError(err: unknown): DbError {
  if (err instanceof DbFailure) return err.dbError
  if (err instanceof Error) return { message: err.message }
  return { message: String(err) }
}

/**
 * Owns every open connection. Each editor tab gets its own session (like DataGrip consoles);
 * the database explorer uses one shared "meta" session per data source.
 */
export class SessionManager {
  private entries = new Map<string, Entry>()
  private opening = new Map<string, Promise<Entry>>()
  private tableInfoCache = new Map<string, TableInfo>()
  private lostTransactions = new Set<string>()
  private exports = new Map<string, AbortController>()

  constructor(private resolve: (connectionId: string) => ResolvedProfile) {}

  private async entry(sessionId: string, connectionId: string): Promise<Entry> {
    const existing = this.entries.get(sessionId)
    if (existing?.connectionId === connectionId) return existing
    if (existing) await this.closeSession(sessionId)
    const pending = this.opening.get(sessionId)
    if (pending) return pending
    const opening = (async () => {
      const profile = this.resolve(connectionId)
      const adapter = adapterFor(profile.engine)
      const session = await adapter.open(profile)
      const e: Entry = { connectionId, adapter, session, autoCommit: true, lock: Promise.resolve() }
      this.entries.set(sessionId, e)
      return e
    })()
    this.opening.set(sessionId, opening)
    try {
      return await opening
    } finally {
      this.opening.delete(sessionId)
    }
  }

  private run<T>(e: Entry, fn: () => Promise<T>): Promise<T> {
    const next = e.lock.then(fn, fn)
    e.lock = next.catch(() => undefined)
    return next
  }

  /** Metadata work for the explorer, completion and table editors. */
  async meta<T>(connectionId: string, fn: (a: Adapter, s: DbSession) => Promise<T>): Promise<T> {
    const id = `meta:${connectionId}`
    const e = await this.entry(id, connectionId)
    try {
      return await this.run(e, () => fn(e.adapter, e.session))
    } catch (err) {
      if (isConnectionLost(err)) await this.closeSession(id)
      throw err
    }
  }

  async tableInfo(connectionId: string, schema: string, table: string): Promise<TableInfo> {
    const key = `${connectionId}|${schema}|${table}`
    const cached = this.tableInfoCache.get(key)
    if (cached) return cached
    const info = await this.meta(connectionId, (a, s) => a.tableInfo(s, schema, table))
    this.tableInfoCache.set(key, info)
    return info
  }

  invalidate(connectionId: string): void {
    for (const k of this.tableInfoCache.keys()) if (k.startsWith(connectionId + '|')) this.tableInfoCache.delete(k)
  }

  private guard(sessionId: string, connectionId: string, sql: string): void {
    // ponytail: keyword guard, not a sandbox — use a read-only database role for a hard boundary
    if (this.resolve(connectionId).readOnly && /\bread\s+write\b/i.test(sql)) {
      throw new DbFailure({ message: 'This data source is read-only; switching the session to READ WRITE is not allowed.' })
    }
    if (this.lostTransactions.delete(sessionId)) {
      throw new DbFailure({ message: 'The session was closed and its open transaction was rolled back. Nothing was executed — run the statement again to continue on a new session.' })
    }
  }

  /** Runs one statement on the session without a fetch limit, handing its rows to `onRows` batch by batch (exports). */
  async stream(
    sessionId: string,
    connectionId: string,
    sql: string,
    opts: Pick<ExecOptions, 'params' | 'schema'> & { countSql?: string | null },
    onRows: RowSink,
    onTotal?: (total: number | null) => void
  ): Promise<void> {
    this.guard(sessionId, connectionId, sql)
    // between batches nothing runs on the server, so an engine cancel can't stop an export: the sink checks this flag
    const abort = new AbortController()
    this.exports.set(sessionId, abort)
    const stop = () => {
      if (abort.signal.aborted) throw new DbFailure({ message: 'Export cancelled' })
    }
    const sink: RowSink = async (rows, columns) => {
      stop()
      await onRows(rows, columns)
      stop()
    }
    try {
      const e = await this.entry(sessionId, connectionId)
      await this.run(e, async () => {
        stop()
        await this.applySchema(e, opts.schema)
        // inside an open transaction a failing count would abort it (PostgreSQL), so progress goes without a total
        onTotal?.(opts.countSql && !e.session.inTransaction ? await this.countQuietly(e, opts.countSql, opts.params) : null)
        stop()
        if (!e.autoCommit && !e.session.inTransaction) await e.session.query(e.adapter.beginSql)
        await e.session.stream(sql, opts.params, sink)
      })
    } catch (err) {
      if (isConnectionLost(err)) await this.closeSession(sessionId)
      throw err
    } finally {
      if (this.exports.get(sessionId) === abort) this.exports.delete(sessionId)
    }
  }

  /** A count is only for the progress bar: any failure just means "unknown". */
  private async countQuietly(e: Entry, sql: string, params: CellValue[] | undefined): Promise<number | null> {
    try {
      const n = Number((await e.session.query(sql, params)).rows[0]?.[0])
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }

  engineOf(connectionId: string): Engine {
    return this.resolve(connectionId).engine
  }

  /** The table editor's SELECT with its filter and order, but every row (minus the grid's hidden rowid), and its count. */
  async tableSql(connectionId: string, q: TableQuery): Promise<{ sql: string; count: string }> {
    return { sql: await this.selectSql(connectionId, { ...q, limit: undefined, offset: 0 }, 'export'), count: await this.selectSql(connectionId, q, 'count') }
  }

  async execute(sessionId: string, connectionId: string, sql: string, opts: ExecOptions): Promise<ExecResult> {
    const started = performance.now()
    let e: Entry | undefined
    try {
      this.guard(sessionId, connectionId, sql)
      e = await this.entry(sessionId, connectionId)
      const entry = e
      const keyword = leadingKeyword(sql, entry.adapter.engine)
      const out = await this.run(entry, async () => {
        // tx control must work even in an aborted PG transaction, where SET would fail
        if (!TX_CONTROL.has(keyword)) await this.applySchema(entry, opts.schema)
        if (!entry.autoCommit && !entry.session.inTransaction && !TX_CONTROL.has(keyword)) {
          await entry.session.query(entry.adapter.beginSql)
        }
        const res = await entry.session.query(sql, opts.params, opts.limit)
        if (keyword === 'ROLLBACK' || keyword === 'ABORT') entry.schema = undefined // SET search_path was rolled back too
        return res
      })
      return this.result(sql, started, entry, out)
    } catch (err) {
      if (isConnectionLost(err)) await this.closeSession(sessionId)
      return { sql, durationMs: performance.now() - started, inTransaction: e?.session.inTransaction ?? false, error: toDbError(err) }
    }
  }

  private async applySchema(e: Entry, schema: string | undefined): Promise<void> {
    if (!schema || schema === e.schema) return
    const stmt = e.adapter.setSchemaSql(schema)
    if (stmt) await e.session.query(stmt)
    e.schema = schema
  }

  private result(sql: string, started: number, e: Entry, out: QueryOutput): ExecResult {
    return {
      sql,
      durationMs: performance.now() - started,
      inTransaction: e.session.inTransaction,
      result: out.returnsRows ? { columns: out.columns, rows: out.rows, hasMore: out.hasMore } : undefined,
      affected: out.affected,
      command: out.command
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.exports.get(sessionId)?.abort()
    await this.entries.get(sessionId)?.session.cancel()
  }

  async closeSession(sessionId: string): Promise<void> {
    const e = this.entries.get(sessionId)
    this.entries.delete(sessionId)
    // remember that work was discarded, so a later Commit cannot report false success
    if (e?.session.inTransaction) this.lostTransactions.add(sessionId)
    await e?.session.close().catch(() => undefined)
  }

  /** Closes every session of a data source (explorer + all its tabs). */
  async disconnect(connectionId: string): Promise<void> {
    const ids = [...this.entries].filter(([, e]) => e.connectionId === connectionId).map(([id]) => id)
    await Promise.all(ids.map((id) => this.closeSession(id)))
    this.invalidate(connectionId)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.closeSession(id)))
  }

  isConnected(connectionId: string): boolean {
    return [...this.entries.values()].some((e) => e.connectionId === connectionId)
  }

  async setAutoCommit(sessionId: string, connectionId: string, autoCommit: boolean): Promise<boolean> {
    const e = await this.entry(sessionId, connectionId)
    e.autoCommit = autoCommit
    return e.session.inTransaction
  }

  async endTransaction(sessionId: string, verb: 'COMMIT' | 'ROLLBACK'): Promise<ExecResult> {
    const started = performance.now()
    const e = this.entries.get(sessionId)
    if (this.lostTransactions.delete(sessionId)) {
      return { sql: verb, durationMs: 0, inTransaction: false, error: { message: 'The session was closed (disconnect or data source change); its open transaction was rolled back.' } }
    }
    if (!e) return { sql: verb, durationMs: 0, inTransaction: false, command: verb }
    try {
      const out = await this.run(e, () => e.session.query(verb))
      if (verb === 'ROLLBACK') e.schema = undefined
      return this.result(verb, started, e, out)
    } catch (err) {
      return { sql: verb, durationMs: performance.now() - started, inTransaction: e.session.inTransaction, error: toDbError(err) }
    }
  }

  private async selectSql(connectionId: string, q: TableQuery, projection: 'rows' | 'export' | 'count'): Promise<string> {
    const info = await this.tableInfo(connectionId, q.schema, q.table)
    const engine = this.resolve(connectionId).engine
    // the grid needs rowid to edit rowid tables; an export shows only what the grid shows
    const cols = projection === 'count' ? 'count(*)' : projection === 'rows' && info.rowid ? 'rowid AS "rowid", *' : '*'
    let sql = `SELECT ${cols} FROM ${qualified(q.schema, q.table, engine)}`
    if (q.where?.trim()) sql += ` WHERE ${q.where}`
    if (projection !== 'count') {
      if (q.orderBy?.trim()) sql += ` ORDER BY ${q.orderBy}`
      if (q.limit !== undefined) sql += ` LIMIT ${Math.max(1, Math.floor(q.limit)) + 1} OFFSET ${Math.max(0, Math.floor(q.offset))}`
    }
    return sql
  }

  /** Server-side paged table data; fetches one extra row to know whether another page exists. */
  async tableData(sessionId: string, connectionId: string, q: TableQuery): Promise<ExecResult> {
    let sql = ''
    try {
      sql = await this.selectSql(connectionId, q, 'rows')
    } catch (err) {
      return { sql, durationMs: 0, inTransaction: false, error: toDbError(err) }
    }
    const res = await this.execute(sessionId, connectionId, sql, {})
    if (q.limit !== undefined && res.result && res.result.rows.length > q.limit) {
      res.result = { ...res.result, rows: res.result.rows.slice(0, q.limit), hasMore: true }
    }
    return res
  }

  async countRows(sessionId: string, connectionId: string, q: TableQuery): Promise<number> {
    const res = await this.execute(sessionId, connectionId, await this.selectSql(connectionId, q, 'count'), {})
    if (res.error) throw new Error(res.error.message)
    return Number(res.result?.rows[0]?.[0] ?? 0)
  }

  /** Runs generated DML atomically; every UPDATE/DELETE must hit exactly one row. */
  async applyChanges(sessionId: string, connectionId: string, changes: ChangeSet): Promise<ExecResult> {
    const started = performance.now()
    const profile = this.resolve(connectionId)
    const statements = generateDml(changes, profile.engine)
    const preview = statements.map((s) => inlineParams(s.sql, s.params, profile.engine) + ';').join('\n')
    let e: Entry | undefined
    try {
      e = await this.entry(sessionId, connectionId)
      const entry = e
      let affected = 0
      await this.run(entry, async () => {
        // auto-commit: own a transaction for the batch; manual mode: join (or open) the console's transaction
        const owned = entry.autoCommit && !entry.session.inTransaction
        if (!entry.session.inTransaction) await entry.session.query(entry.adapter.beginSql)
        try {
          for (const st of statements) {
            const out = await entry.session.query(st.sql, st.params)
            if (st.expectOne && out.affected !== 1) {
              throw new DbFailure({
                message: `Expected to change exactly 1 row, but ${out.affected ?? 0} rows matched:\n${inlineParams(st.sql, st.params, profile.engine)}`
              })
            }
            affected += out.affected ?? 0
          }
          if (owned) await entry.session.query('COMMIT')
        } catch (err) {
          if (owned) await entry.session.query('ROLLBACK').catch(() => undefined)
          throw err
        }
      })
      return { sql: preview, durationMs: performance.now() - started, inTransaction: entry.session.inTransaction, affected }
    } catch (err) {
      return { sql: preview, durationMs: performance.now() - started, inTransaction: e?.session.inTransaction ?? false, error: toDbError(err) }
    }
  }

  async explain(sessionId: string, connectionId: string, sql: string, analyze: boolean, schema?: string): Promise<PlanNode[]> {
    const e = await this.entry(sessionId, connectionId)
    return this.run(e, async () => {
      await this.applySchema(e, schema)
      return e.adapter.explain(e.session, sql, analyze)
    })
  }

  async test(profile: ResolvedProfile): Promise<TestResult> {
    const started = performance.now()
    const adapter = adapterFor(profile.engine)
    let session: DbSession | undefined
    try {
      session = await adapter.open(profile)
      const version = await adapter.serverVersion(session)
      return { ok: true, version, ms: Math.round(performance.now() - started) }
    } catch (err) {
      return { ok: false, ms: Math.round(performance.now() - started), error: toDbError(err) }
    } finally {
      await session?.close().catch(() => undefined)
    }
  }
}
