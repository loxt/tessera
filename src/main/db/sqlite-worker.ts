import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { homedir } from 'node:os'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { CellValue, ColumnMeta, DbError } from '@shared/model'
import { leadingKeyword } from '@shared/sql'
import { toBinary, type QueryOutput } from './types'

export interface SqliteRequest {
  sql: string
  /** already converted with toDriverParam (binary → Buffer/Uint8Array) */
  params: unknown[]
  limit?: number
  /** paged read for exports: the first request opens cursor `id`, each one returns up to `take` rows; take 0 closes it */
  cursor?: { id: number; take: number }
}
export type SqliteResponse = { ok: QueryOutput; inTransaction: boolean } | { error: DbError; inTransaction: boolean }

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

function cell(v: unknown): CellValue {
  if (typeof v === 'bigint') return v <= MAX_SAFE && v >= -MAX_SAFE ? Number(v) : v.toString()
  if (v instanceof Uint8Array) return toBinary(v)
  return v as CellValue
}

const bindable = (v: unknown): SQLInputValue => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as SQLInputValue))

export function toDbError(e: unknown): DbError {
  const err = e as { message?: string; errcode?: number; errstr?: string }
  return {
    message: err.message ?? String(e),
    ...(err.errcode !== undefined ? { code: String(err.errcode) } : {}),
    ...(err.errstr ? { detail: err.errstr } : {})
  }
}

export const expandHome = (file: string) => (file === '~' || file.startsWith('~/') ? homedir() + file.slice(1) : file)

/** Opens the database and returns a synchronous request handler. Throws when the file can't be opened. */
export function createSqliteHandler(file: string, readOnly: boolean): { handle(req: SqliteRequest): SqliteResponse; close(): void } {
  // busy timeout: after a cancel, the discarded thread may still hold a lock for a moment
  const db = new DatabaseSync(expandHome(file), { readOnly, timeout: 5000 })
  db.exec('PRAGMA foreign_keys = ON')
  const cursors = new Map<number, { it: Iterator<unknown[]>; columns: ColumnMeta[] }>()

  const prepare = (sql: string, params: unknown[]) => {
    const stmt = db.prepare(sql)
    stmt.setReadBigInts(true)
    stmt.setReturnArrays(true)
    return { stmt, args: params.map(bindable), columns: stmt.columns().map((c): ColumnMeta => ({ name: c.name, type: c.type ?? '' })) }
  }

  const page = (req: SqliteRequest, cursor: { id: number; take: number }): QueryOutput => {
    let c = cursors.get(cursor.id)
    if (cursor.take === 0) {
      c?.it.return?.()
      cursors.delete(cursor.id)
      return { returnsRows: false, columns: [], rows: [], hasMore: false }
    }
    if (!c) {
      const { stmt, args, columns } = prepare(req.sql, req.params)
      if (columns.length === 0) return run(req)
      c = { it: (stmt.iterate(...args) as IterableIterator<unknown[]>)[Symbol.iterator](), columns }
      cursors.set(cursor.id, c)
    }
    const rows: CellValue[][] = []
    try {
      while (rows.length < cursor.take) {
        const next = c.it.next()
        if (next.done) {
          cursors.delete(cursor.id)
          return { returnsRows: true, columns: c.columns, rows, hasMore: false }
        }
        rows.push(next.value.map(cell))
      }
    } catch (e) {
      cursors.delete(cursor.id)
      throw e
    }
    return { returnsRows: true, columns: c.columns, rows, hasMore: true }
  }

  const run = (req: SqliteRequest): QueryOutput => {
    const { sql, limit } = req
    const { stmt, args, columns } = prepare(sql, req.params)
    if (columns.length === 0) {
      const r = stmt.run(...args)
      return { returnsRows: false, columns: [], rows: [], hasMore: false, affected: Number(r.changes), command: leadingKeyword(sql, 'sqlite') }
    }
    const rows: CellValue[][] = []
    let hasMore = false
    for (const row of stmt.iterate(...args) as Iterable<unknown[]>) {
      if (limit !== undefined && rows.length >= limit) {
        hasMore = true
        break
      }
      rows.push(row.map(cell))
    }
    return { returnsRows: true, columns, rows, hasMore }
  }

  return {
    handle(req) {
      try {
        return { ok: req.cursor ? page(req, req.cursor) : run(req), inTransaction: db.isTransaction }
      } catch (e) {
        return { error: toDbError(e), inTransaction: db.isOpen && db.isTransaction }
      }
    },
    close: () => db.isOpen && db.close()
  }
}

export interface WorkerInit {
  file: string
  readOnly: boolean
}
export type WorkerMessage = { id: number; req: SqliteRequest } | { id: number; close: true }

if (!isMainThread && parentPort) {
  const port = parentPort
  const init = workerData as WorkerInit
  let handler: ReturnType<typeof createSqliteHandler> | undefined
  let openError: DbError | undefined
  try {
    handler = createSqliteHandler(init.file, init.readOnly)
  } catch (e) {
    openError = toDbError(e)
  }
  port.on('message', (msg: WorkerMessage) => {
    if ('close' in msg) {
      handler?.close()
      port.postMessage({ id: msg.id, ok: null, inTransaction: false })
      return
    }
    port.postMessage({ id: msg.id, ...(handler ? handler.handle(msg.req) : { error: openError!, inTransaction: false }) })
  })
}
