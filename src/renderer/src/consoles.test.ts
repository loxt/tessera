import { describe, expect, test } from 'vitest'
import type { ConsoleFile, TabState } from '@shared/model'
import { migrateTabs, nextConsoleName } from './consoles'

describe('nextConsoleName', () => {
  test('follows DataGrip naming and fills gaps', () => {
    expect(nextConsoleName([])).toBe('console')
    expect(nextConsoleName(['console'])).toBe('console_1')
    expect(nextConsoleName(['console', 'console_1', 'console_3'])).toBe('console_2')
    expect(nextConsoleName(['reports'])).toBe('console')
  })
})

describe('migrateTabs', () => {
  const existing: ConsoleFile = { id: 'c1', connectionId: 'db', name: 'console', text: 'select 1', updatedAt: 1 }
  let n = 0
  const ids = () => `new${++n}`

  test('turns legacy console tabs (text in the tab) into saved consoles', () => {
    const legacy = { kind: 'console', id: 't1', connectionId: 'db', title: 'db', text: 'select 2', autoCommit: true, schema: 'app' } as unknown as TabState
    const out = migrateTabs([legacy], [existing], ids, 5)
    expect(out.consoles).toHaveLength(2)
    expect(out.consoles[1]).toEqual({ id: 'new1', connectionId: 'db', name: 'console_1', text: 'select 2', schema: 'app', updatedAt: 5 })
    expect(out.tabs[0]).toMatchObject({ kind: 'console', consoleId: 'new1', title: 'console_1' })
  })

  test('drops console tabs whose console no longer exists and keeps other tabs', () => {
    const orphan: TabState = { kind: 'console', id: 't2', connectionId: 'db', title: 'x', consoleId: 'gone', autoCommit: true }
    const table: TabState = { kind: 'table', id: 't3', connectionId: 'db', title: 'users', schema: 'public', table: 'users' }
    expect(migrateTabs([orphan, table], [existing], ids, 5).tabs).toEqual([table])
  })
})
