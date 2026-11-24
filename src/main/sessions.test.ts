import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { exportResult } from '@shared/export'
import type { ExportProgress } from '@shared/model'
import { exportToFile } from './export'
import { SessionManager } from './sessions'

let dir = ''
let sessions: SessionManager

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tessera-sessions-'))
  const file = join(dir, 'shop.db')
  new DatabaseSync(file).exec(readFileSync(resolve('fixtures/sqlite.sql'), 'utf8'))
  sessions = new SessionManager(() => ({ id: 't', name: 't', hasPassword: false, engine: 'sqlite', file }))
})
afterAll(async () => {
  await sessions.closeAll()
  rmSync(dir, { recursive: true, force: true })
})

describe('tableData', () => {
  const q = { schema: 'main', table: 'customers', orderBy: 'id', offset: 0 }

  test('pages by limit and flags the cut', async () => {
    const res = await sessions.tableData('s', 't', { ...q, limit: 2 })
    expect(res.result?.rows).toHaveLength(2)
    expect(res.result?.hasMore).toBe(true)
  })

  test('omitting limit returns every row', async () => {
    const total = await sessions.countRows('s', 't', q)
    const res = await sessions.tableData('s', 't', q)
    expect(res.result?.rows).toHaveLength(total)
    expect(res.result?.hasMore).toBe(false)
    expect(total).toBeGreaterThan(2)
  })
})

describe('exportToFile', () => {
  const src = { sessionId: 'x', connectionId: 't' }
  const out = (name: string) => join(dir, name)
  const numbers = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2500) SELECT i FROM n`

  test('streams every row across batch boundaries', async () => {
    const rows = await exportToFile(sessions, { ...src, kind: 'sql', sql: numbers }, 'csv', {}, out('n.csv'))
    expect(rows).toBe(2500)
    const lines = readFileSync(out('n.csv'), 'utf8').trimEnd().split('\n')
    expect(lines).toEqual(['i', ...Array.from({ length: 2500 }, (_, k) => String(k + 1))])
  })

  test('reports progress against the row count', async () => {
    const seen: ExportProgress[] = []
    await exportToFile(sessions, { ...src, kind: 'sql', sql: numbers, filter: '250' }, 'csv', {}, out('p.csv'), (p) => seen.push(p))
    expect(seen.map((p) => p.read)).toEqual([1000, 2000, 2500])
    expect(seen.at(-1)).toEqual({ read: 2500, written: 4, total: 2500 })
  })

  test('counts a table export from its filter', async () => {
    const seen: ExportProgress[] = []
    const query = { schema: 'main', table: 'customers', where: 'id > 1', offset: 0 }
    const rows = await exportToFile(sessions, { ...src, kind: 'table', query }, 'csv', {}, out('t.csv'), (p) => seen.push(p))
    expect(seen.at(-1)).toEqual({ read: rows, written: rows, total: await sessions.countRows('s', 't', query) })
  })

  test('applies the grid quick filter', async () => {
    const rows = await exportToFile(sessions, { ...src, kind: 'sql', sql: numbers, filter: '250' }, 'jsonl', {}, out('f.jsonl'))
    expect(readFileSync(out('f.jsonl'), 'utf8')).toBe('{"i":250}\n{"i":1250}\n{"i":2250}\n{"i":2500}\n')
    expect(rows).toBe(4)
  })

  test('exports a whole table, matching the grid query', async () => {
    const query = { schema: 'main', table: 'customers', orderBy: 'id', limit: 2, offset: 2 }
    const rows = await exportToFile(sessions, { ...src, kind: 'table', query }, 'json', {}, out('c.json'))
    const all = await sessions.tableData('s', 't', { ...query, limit: undefined, offset: 0 })
    expect(readFileSync(out('c.json'), 'utf8')).toBe(exportResult(all.result!, 'json'))
    expect(rows).toBe(all.result!.rows.length)
  })

  test('removes the partial file when the query fails', async () => {
    await expect(exportToFile(sessions, { ...src, kind: 'sql', sql: 'SELECT * FROM nope' }, 'csv', {}, out('bad.csv'))).rejects.toThrow(/nope/)
    expect(existsSync(out('bad.csv'))).toBe(false)
  })
})

describe('exportToFile safety', () => {
  const src = { sessionId: 'y', connectionId: 't' }
  const numbers = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2500) SELECT i FROM n`

  test('a failed export over an existing file leaves that file intact', async () => {
    const path = join(dir, 'keep.csv')
    writeFileSync(path, 'precious')
    await expect(exportToFile(sessions, { ...src, kind: 'sql', sql: 'SELECT * FROM nope' }, 'csv', {}, path)).rejects.toThrow(/nope/)
    expect(readFileSync(path, 'utf8')).toBe('precious')
    expect(readdirSync(dir).filter((f) => f.includes('tessera-tmp'))).toEqual([])
  })

  test('cancel stops an export between batches', async () => {
    const path = join(dir, 'cancelled.csv')
    const running = exportToFile(sessions, { ...src, kind: 'sql', sql: numbers }, 'csv', {}, path)
    await sessions.cancel('y')
    await expect(running).rejects.toThrow(/cancelled/i)
    expect(existsSync(path)).toBe(false)
  })

  test('a sqlite table export leaves out the hidden rowid column', async () => {
    const path = join(dir, 'audit.csv')
    await exportToFile(sessions, { ...src, kind: 'table', query: { schema: 'main', table: 'audit_log', offset: 0 } }, 'csv', {}, path)
    expect(readFileSync(path, 'utf8').split('\n')[0]).not.toMatch(/rowid/)
  })
})
