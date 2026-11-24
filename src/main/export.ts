import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { countSql, createExporter, rowMatches, type ExportFormat, type ExportOptions } from '@shared/export'
import type { ExportProgress, ExportSource } from '@shared/model'
import type { SessionManager } from './sessions'

export type OnProgress = (p: ExportProgress) => void

/** Re-runs the export source and writes it chunk by chunk; `write` resolving means "send more". Returns rows written. */
async function dump(
  sessions: SessionManager,
  source: ExportSource,
  format: ExportFormat,
  opts: ExportOptions,
  write: (chunk: string) => Promise<void>,
  onProgress?: OnProgress
): Promise<number> {
  const { sql, count } =
    source.kind === 'table' ? await sessions.tableSql(source.connectionId, source.query) : { sql: source.sql, count: countSql(source.sql, sessions.engineOf(source.connectionId)) }
  const params = source.kind === 'sql' ? source.params : undefined
  const schema = source.kind === 'sql' ? source.schema : undefined
  const needle = source.kind === 'sql' ? source.filter?.toLowerCase() : undefined
  let ex: ReturnType<typeof createExporter> | undefined
  const progress: ExportProgress = { read: 0, written: 0, total: null }
  await sessions.stream(
    source.sessionId,
    source.connectionId,
    sql,
    { params, schema, countSql: count },
    async (rows, columns) => {
      if (!ex) {
        ex = createExporter(columns, format, opts)
        await write(ex.head())
      }
      const kept = needle ? rows.filter((r) => rowMatches(r, needle)) : rows
      await write(ex.rows(kept))
      progress.read += rows.length
      progress.written += kept.length
      onProgress?.({ ...progress })
    },
    (total) => (progress.total = total)
  )
  if (ex) await write(ex.tail())
  return progress.written
}

/** Streams every row to `path`, waiting for the disk between batches. Writes a sibling temp file and renames it
 * into place only when complete, so a failed or cancelled export neither leaves a partial file nor destroys the
 * file the user chose to overwrite. */
export async function exportToFile(
  sessions: SessionManager,
  source: ExportSource,
  format: ExportFormat,
  opts: ExportOptions,
  path: string,
  onProgress?: OnProgress
): Promise<number> {
  const tmp = `${path}.${process.pid}.tessera-tmp`
  const out = createWriteStream(tmp, 'utf8')
  let failed: Error | undefined
  out.on('error', (e) => (failed = e))
  const write = async (chunk: string) => {
    if (failed) throw failed
    if (chunk && !out.write(chunk)) await once(out, 'drain')
  }
  try {
    const rows = await dump(sessions, source, format, opts, write, onProgress)
    out.end()
    await once(out, 'close')
    await rename(tmp, path)
    return rows
  } catch (err) {
    // the file opens asynchronously: wait for close, or unlink could run before it even exists
    if (!out.closed) await new Promise<void>((resolve) => out.once('close', () => resolve()).destroy())
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/** the clipboard holds one string in memory; anything bigger belongs in a file */
const MAX_CLIPBOARD_CHARS = 50_000_000

/** For the clipboard: the whole export as one string, refused past MAX_CLIPBOARD_CHARS. */
export async function exportToText(sessions: SessionManager, source: ExportSource, format: ExportFormat, opts: ExportOptions, onProgress?: OnProgress): Promise<string> {
  const parts: string[] = []
  let size = 0
  const write = async (chunk: string) => {
    size += chunk.length
    if (size > MAX_CLIPBOARD_CHARS) throw new Error('Too much data for the clipboard — use Save to File instead.')
    parts.push(chunk)
  }
  await dump(sessions, source, format, opts, write, onProgress)
  return parts.join('')
}
