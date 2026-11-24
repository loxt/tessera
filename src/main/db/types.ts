import type {
  CellValue,
  ColumnMeta,
  CompletionMetadata,
  ConnectionProfile,
  DbError,
  DbNode,
  Engine,
  ObjectPath,
  PlanNode,
  TableInfo
} from '@shared/model'

/** Profile with its decrypted secret. Exists only inside the main process. */
export type ResolvedProfile = ConnectionProfile & { password?: string }

export interface QueryOutput {
  /** true when the statement produced a row set (even an empty one) */
  returnsRows: boolean
  columns: ColumnMeta[]
  rows: CellValue[][]
  /** true when `limit` cut the result */
  hasMore: boolean
  affected?: number
  /** server command tag, e.g. "INSERT", "UPDATE" (best effort) */
  command?: string
}

export type RowSink = (rows: CellValue[][], columns: ColumnMeta[]) => Promise<void>

/** rows fetched per round trip when streaming an export */
export const STREAM_BATCH = 1000

/** One physical connection. Engine adapters implement this; SessionManager adds IDE semantics on top. */
export interface DbSession {
  readonly engine: Engine
  /** Kept accurate after every query (explicit BEGIN/COMMIT included). */
  readonly inTransaction: boolean
  /**
   * Execute exactly one statement. `limit` caps returned rows (fetch limit, not SQL LIMIT).
   * Rejects with DbFailure.
   */
  query(sql: string, params?: CellValue[], limit?: number): Promise<QueryOutput>
  /**
   * Execute one statement and hand its rows over in batches of STREAM_BATCH, fetching the next batch only after
   * `onRows` settles. `onRows` runs at least once, so the columns are known even for an empty result.
   */
  stream(sql: string, params: CellValue[] | undefined, onRows: RowSink): Promise<void>
  /** Abort the statement currently running on this session (no-op when idle). */
  cancel(): Promise<void>
  close(): Promise<void>
}

export interface Adapter {
  readonly engine: Engine
  open(profile: ResolvedProfile): Promise<DbSession>
  /** e.g. "PostgreSQL 17.2" */
  serverVersion(s: DbSession): Promise<string>
  /** statement that opens a transaction in manual-commit mode */
  readonly beginSql: string
  /** statement that makes `schema` the default for unqualified names, or null if unsupported */
  setSchemaSql(schema: string): string | null
  listChildren(s: DbSession, path: ObjectPath | null, showSystem: boolean): Promise<DbNode[]>
  tableInfo(s: DbSession, schema: string, table: string): Promise<TableInfo>
  /** kind: table | view | routine | sequence */
  ddl(s: DbSession, kind: string, schema: string, name: string): Promise<string>
  /** hidden: schemas the user hid; left out so they don't use up the completion caps */
  metadata(s: DbSession, showSystem: boolean, hidden?: string[]): Promise<CompletionMetadata>
  explain(s: DbSession, sql: string, analyze: boolean): Promise<PlanNode[]>
}

export class DbFailure extends Error {
  constructor(readonly dbError: DbError) {
    super(dbError.message)
  }
}

/** Binary values are shown truncated; this is the cap in bytes. */
export const BINARY_PREVIEW_BYTES = 4096

export function toBinary(buf: Uint8Array): CellValue {
  const view = buf.subarray(0, BINARY_PREVIEW_BYTES)
  return { $t: 'binary', hex: Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex'), size: buf.byteLength }
}

/** Converts IPC cell values into driver parameters (binary → Buffer). */
export function toDriverParam(v: CellValue): unknown {
  return v !== null && typeof v === 'object' ? Buffer.from(v.hex, 'hex') : v
}

/** TLS options for a profile's SSL mode; false = plaintext. */
export function tlsOptions(mode: ResolvedProfile['ssl'], host: string | undefined): false | { rejectUnauthorized: boolean; servername?: string } {
  if (mode === 'verify-full') return { rejectUnauthorized: true, servername: host }
  if (mode === 'require' || mode === 'prefer') return { rejectUnauthorized: false }
  return false
}

/**
 * `prefer` may fall back to plaintext only when the server says it has no TLS —
 * never on certificate or network errors, which would allow a downgrade attack.
 */
export async function connectWithSsl<T>(mode: ResolvedProfile['ssl'], host: string | undefined, attempt: (tls: ReturnType<typeof tlsOptions>) => Promise<T>): Promise<T> {
  if (mode !== 'prefer') return attempt(tlsOptions(mode, host))
  try {
    return await attempt(tlsOptions(mode, host))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code
    if (/does not support SSL|not support secure connection/i.test(msg) || code === 'HANDSHAKE_NO_SSL_SUPPORT') return attempt(false)
    throw err
  }
}

/** Track transaction state from statement keywords (PostgreSQL / MySQL). */
export function txStateAfter(sql: string, keyword: string, current: boolean): boolean {
  if (keyword === 'BEGIN' || keyword === 'START') return true
  if (keyword === 'COMMIT' || keyword === 'END' || keyword === 'ABORT') return false
  if (keyword === 'ROLLBACK') return /^\s*rollback\s+(work\s+)?to\b/i.test(sql) ? current : false
  return current
}
