import { api, errorMessage } from './api'
import { ACTIONS } from '@shared/actions'
import { FONT_SIZE_DEFAULT, stepFontSize } from '@shared/editorFont'
import { themeById } from '@shared/themes'
import { runEditorAction, runGridAction } from './scoped'
import { allTemplates } from './sqlgen'
import {
  activeTab,
  closeTab,
  connectionById,
  cycleTab,
  disconnect,
  findNode,
  keyConnection,
  notify,
  consolesOf,
  openConsole,
  openDdl,
  openModal,
  refreshConnection,
  selectNode,
  setPrefs,
  toggleExpanded,
  renameConsole,
  useApp,
  cycleSplit,
  moveTabToOtherSplit,
  splitTab,
  unsplitPanes
} from './store'

/** Operations a mounted tab exposes to global actions (menu, shortcuts, palette). */
export interface TabController {
  execute?: () => void
  executeScript?: () => void
  cancel?: () => void
  explain?: (analyze: boolean) => void
  commit?: () => void
  rollback?: () => void
  toggleAutoCommit?: () => void
  history?: () => void
  askAi?: () => void
  runOnMany?: () => void
  explainAi?: () => void
  fixAi?: () => void
  format?: () => void
  saveFile?: () => void
  submit?: () => void
  revert?: () => void
  refresh?: () => void
  toggleResults?: () => void
  focus?: () => void
  /** push debounced editor state into the store immediately */
  flush?: () => void
}

export function flushControllers(): void {
  for (const c of controllers.values()) c.flush?.()
}

const controllers = new Map<string, TabController>()

export function registerController(tabId: string, c: TabController): () => void {
  controllers.set(tabId, c)
  return () => {
    if (controllers.get(tabId) === c) controllers.delete(tabId)
  }
}

/** Cancels the query running in a tab, through its controller when it has one (so the console logs it). */
export function cancelTab(tabId: string): void {
  const cancel = controllers.get(tabId)?.cancel
  if (cancel) return cancel()
  api.cancel(tabId).catch((err) => notify('error', errorMessage(err)))
}

const active = (): TabController | undefined => {
  const id = useApp.getState().activeTabId
  return id ? controllers.get(id) : undefined
}

/** Connection in focus: the selected explorer node, otherwise the active tab's data source. */
export function focusedConnectionId(): string | undefined {
  const { selectedNode, connections } = useApp.getState()
  if (selectedNode) return keyConnection(selectedNode)
  return activeTab()?.connectionId ?? (connections.length === 1 ? connections[0].id : undefined)
}

function requireConnection(): string | undefined {
  const id = focusedConnectionId()
  if (!id) notify('info', 'Select a data source in the Database Explorer first.')
  return id
}

async function showDdlForSelection(): Promise<void> {
  const key = useApp.getState().selectedNode
  const node = key ? findNode(key) : undefined
  const tab = activeTab()
  try {
    if (node && ['table', 'view', 'routine', 'sequence'].includes(node.kind) && node.path.schema) {
      const connId = keyConnection(key!)
      openDdl(connId, `${node.name}.sql`, await api.ddl(connId, node.kind, node.path.schema, node.name))
    } else if (tab?.kind === 'table') {
      openDdl(tab.connectionId, `${tab.table}.sql`, await api.ddl(tab.connectionId, 'table', tab.schema, tab.table))
    } else notify('info', 'Select a table, view or routine first.')
  } catch (err) {
    notify('error', errorMessage(err))
  }
}

const handlers: Record<string, () => void | Promise<void>> = {
  'connection.new': () => openModal({ kind: 'connection' }),
  'connection.fromUrl': () => openModal({ kind: 'connection' }),
  'connection.properties': () => {
    const id = requireConnection()
    if (id) openModal({ kind: 'connection', editId: id })
  },
  'connection.disconnect': () => {
    const id = requireConnection()
    if (id) void disconnect(id)
  },
  // ⌘⇧L: like DataGrip, pick one of the data source's saved consoles or start a new one
  'console.new': () => {
    const id = requireConnection()
    if (!id) return
    if (consolesOf(id).length) openModal({ kind: 'palette', mode: 'consoles', connectionId: id })
    else openConsole(id)
  },
  'console.create': () => {
    const id = requireConnection()
    if (id) openConsole(id)
  },
  'console.openFile': async () => {
    const id = requireConnection()
    if (!id) return
    const f = await api.openFile([{ name: 'SQL', extensions: ['sql', 'txt'] }, { name: 'All files', extensions: ['*'] }], true)
    if (f) openConsole(id, f.content ?? '', { name: f.path.split('/').pop() ?? 'script.sql' })
  },
  'console.rename': () => {
    const tab = activeTab()
    if (tab?.kind === 'console') void renameConsole(tab.consoleId)
  },
  'console.saveFile': () => active()?.saveFile?.(),
  'tab.close': () => {
    const id = useApp.getState().activeTabId
    if (id) void closeTab(id)
  },
  'tab.next': () => cycleTab(1),
  'tab.prev': () => cycleTab(-1),
  'tab.recent': () => openModal({ kind: 'palette', mode: 'tabs' }),
  'settings.open': () => openModal({ kind: 'settings' }),
  'search.everywhere': () => openModal({ kind: 'palette', mode: 'all' }),
  'search.actions': () => openModal({ kind: 'palette', mode: 'actions' }),
  'search.tables': () => openModal({ kind: 'palette', mode: 'tables' }),
  'explorer.selectCurrent': () => {
    const tab = activeTab()
    if (!tab) return
    useApp.setState({ showExplorer: true })
    toggleExpanded(tab.connectionId, true)
    if (tab.kind === 'table') {
      toggleExpanded(`${tab.connectionId}::schema:${tab.schema}`, true)
      toggleExpanded(`${tab.connectionId}::folder:${tab.schema}/tables`, true)
      selectNode(`${tab.connectionId}::table:${tab.schema}/${tab.table}`)
    } else selectNode(tab.connectionId)
  },
  'explorer.refresh': () => {
    const tab = active()
    if (tab?.refresh && !useApp.getState().selectedNode) return tab.refresh()
    const id = requireConnection()
    if (id) void refreshConnection(id).then(() => notify('info', `Refreshed ${connectionById(id)?.name}`))
  },
  'object.ddl': () => void showDdlForSelection(),
  'object.sqlGenerator': async () => {
    const key = useApp.getState().selectedNode
    const node = key ? findNode(key) : undefined
    const tab = activeTab()
    const target =
      node && (node.kind === 'table' || node.kind === 'view') && node.path.schema
        ? { connId: keyConnection(key!), schema: node.path.schema, table: node.name }
        : tab?.kind === 'table'
          ? { connId: tab.connectionId, schema: tab.schema, table: tab.table }
          : undefined
    if (!target) return notify('info', 'Select a table first.')
    try {
      const info = await api.tableInfo(target.connId, target.schema, target.table)
      openConsole(target.connId, allTemplates(info, connectionById(target.connId)!.engine))
    } catch (err) {
      notify('error', errorMessage(err))
    }
  },

  'query.execute': () => {
    const c = active()
    ;(c?.submit ?? c?.execute)?.()
  },
  'query.executeScript': () => active()?.executeScript?.(),
  'query.cancel': () => active()?.cancel?.(),
  'query.explain': () => active()?.explain?.(false),
  'query.explainAnalyze': () => active()?.explain?.(true),
  'query.history': () => active()?.history?.(),
  'schema.compare': () => openModal({ kind: 'schemaDiff' }),
  'query.runOnMany': () => active()?.runOnMany?.(),
  'ai.ask': () => active()?.askAi?.(),
  'ai.explain': () => active()?.explainAi?.(),
  'ai.fix': () => active()?.fixAi?.(),
  'tx.commit': () => active()?.commit?.(),
  'tx.rollback': () => active()?.rollback?.(),
  'tx.toggleAuto': () => active()?.toggleAutoCommit?.(),

  'view.toggleExplorer': () => useApp.setState((s) => ({ showExplorer: !s.showExplorer })),
  'view.toggleResults': () => active()?.toggleResults?.(),
  'view.chooseTheme': () => openModal({ kind: 'palette', mode: 'themes' }),
  // jump to the current theme's light/dark counterpart (Mocha ↔ Latte, Graphite ↔ Paper)
  'view.toggleTheme': () => {
    const current = themeById(document.documentElement.dataset.themeId ?? '')
    setPrefs({ theme: current?.pair ?? (document.documentElement.dataset.theme === 'dark' ? 'tessera-paper' : 'tessera-graphite') })
  },
  'view.notifications': () => openModal({ kind: 'notifications' }),
  'grid.submit': () => active()?.submit?.(),
  'grid.revert': () => active()?.revert?.()
}

Object.assign(handlers, {
  'settings.keymap': () => openModal({ kind: 'settings', tab: 'keymap' }),
  'settings.snippets': () => openModal({ kind: 'settings', tab: 'snippets' }),
  'view.fontIncrease': () => setPrefs({ editorFontSize: stepFontSize(useApp.getState().prefs.editorFontSize, 1) }),
  'view.fontDecrease': () => setPrefs({ editorFontSize: stepFontSize(useApp.getState().prefs.editorFontSize, -1) }),
  'view.fontReset': () => setPrefs({ editorFontSize: FONT_SIZE_DEFAULT }),
  'tab.closeOthers': () => {
    const { tabs, activeTabId } = useApp.getState()
    for (const t of tabs) if (t.id !== activeTabId) void closeTab(t.id)
  },
  'tab.closeAll': () => {
    for (const t of useApp.getState().tabs) void closeTab(t.id)
  },
  'view.splitRight': () => splitTab('row'),
  'view.splitDown': () => splitTab('column'),
  'view.unsplit': () => unsplitPanes(),
  'tab.moveToOtherSplit': () => moveTabToOtherSplit(),
  'view.nextSplit': () => cycleSplit(1),
  'view.prevSplit': () => cycleSplit(-1)
})

// Editor- and grid-scoped actions invoked from the menu or Find Action run on the last focused target.
for (const a of ACTIONS) {
  if (a.scope === 'editor') handlers[a.id] = () => void (runEditorAction(a.id) || notify('info', 'Focus a SQL editor first.'))
  if (a.scope === 'grid' && !handlers[a.id]) handlers[a.id] = () => void (runGridAction(a.id) || notify('info', 'Focus a data grid first.'))
}

export const hasHandler = (id: string) => id in handlers

export function dispatch(id: string): void {
  const h = handlers[id]
  if (!h) return
  Promise.resolve()
    .then(h)
    .catch((err) => notify('error', errorMessage(err)))
}
