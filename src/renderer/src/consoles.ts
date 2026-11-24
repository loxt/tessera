import type { ConsoleFile, TabState } from '@shared/model'

/** "console", then the smallest free "console_N" — DataGrip's naming. */
export function nextConsoleName(taken: string[]): string {
  const used = new Set(taken)
  if (!used.has('console')) return 'console'
  for (let i = 1; ; i++) if (!used.has(`console_${i}`)) return `console_${i}`
}

/**
 * Console tabs from older sessions kept their text inside the tab; move that text into a
 * saved console. Tabs pointing at deleted consoles are dropped.
 */
export function migrateTabs(tabs: TabState[], consoles: ConsoleFile[], newId: () => string, now: number): { tabs: TabState[]; consoles: ConsoleFile[] } {
  const out = [...consoles]
  const migrated: TabState[] = []
  for (const tab of tabs) {
    if (tab.kind !== 'console') {
      migrated.push(tab)
      continue
    }
    const legacy = tab as Extract<TabState, { kind: 'console' }> & { text?: string; schema?: string }
    if (!legacy.consoleId && typeof legacy.text === 'string') {
      const name = nextConsoleName(out.filter((c) => c.connectionId === tab.connectionId).map((c) => c.name))
      const file: ConsoleFile = { id: newId(), connectionId: tab.connectionId, name, text: legacy.text, schema: legacy.schema, updatedAt: now }
      out.push(file)
      migrated.push({ kind: 'console', id: tab.id, connectionId: tab.connectionId, title: name, consoleId: file.id, autoCommit: tab.autoCommit })
    } else if (out.some((c) => c.id === legacy.consoleId)) migrated.push(tab)
  }
  return { tabs: migrated, consoles: out }
}
