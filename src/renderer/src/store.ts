import { create } from 'zustand'
import {
  DEFAULT_PREFS,
  type CompletionMetadata,
  type ConnectionInput,
  type ConnectionProfile,
  type ConsoleFile,
  type DbNode,
  type Engine,
  type ExportSource,
  type PaneLayout,
  type Prefs,
  type ResultSet,
  type TabState
} from '@shared/model'
import type { Snippet } from '@shared/snippets'
import type { SavedView } from '@shared/views'
import { api, errorMessage, newId } from './api'
import { migrateTabs, nextConsoleName } from './consoles'
import { setSchemaHidden } from './schemas'
import { endTask, startTask, stepTask, type Tasks } from './tasks'
import {
  activate as layoutActivate,
  activeOf,
  addTab as layoutAdd,
  focusPane as layoutFocus,
  moveToOtherPane,
  normalizeLayout,
  removeTab as layoutRemove,
  single,
  unsplit as layoutUnsplit
} from './layout'
import { accelLabel, effectiveBindings, type Bindings, type KeymapState } from '@shared/keymap'

export const IS_MAC = navigator.platform.toLowerCase().includes('mac')

export interface Toast {
  id: string
  kind: 'info' | 'error' | 'success'
  message: string
  at: number
  action?: { label: string; run: () => void }
}

export interface ConfirmButton {
  label: string
  value: string
  primary?: boolean
  danger?: boolean
}

export type Modal =
  | { kind: 'connection'; initial?: Partial<ConnectionInput>; editId?: string }
  | { kind: 'palette'; mode: 'all' | 'actions' | 'tables' | 'tabs' | 'consoles' | 'themes'; connectionId?: string }
  | { kind: 'prompt'; title: string; label: string; value: string; resolve: (v: string | null) => void }
  /** snippetDraft: SQL to start a new snippet with (Save Selection as Snippet) */
  | { kind: 'settings'; tab?: 'general' | 'keymap' | 'snippets'; snippetDraft?: string }
  | { kind: 'notifications' }
  | { kind: 'history'; connectionId: string; onPick: (sql: string, run: boolean) => void }
  /** a JSON cell, formatted (text is the raw value) */
  | { kind: 'json'; title: string; text: string; onSave?: (text: string) => void }
  | { kind: 'schemaDiff' }
  | { kind: 'diagram'; connectionId: string; schema: string; table: string }
  | { kind: 'import'; connectionId: string; schema: string; table: string; onDone?: () => void }
  | { kind: 'pickConnections'; selected: string[]; resolve: (ids: string[] | null) => void }
  /** source: what to re-run at export time when `result` is only the loaded page */
  | { kind: 'export'; result: ResultSet; table?: string; engine: Engine; source?: ExportSource }
  | { kind: 'params'; names: string[]; initial: Record<string, string>; resolve: (v: Record<string, string | null> | null) => void }
  | { kind: 'confirm'; title: string; message: string; detail?: string; buttons: ConfirmButton[]; resolve: (v: string | null) => void }
  | { kind: 'changes'; preview: string; production?: boolean; engine?: Engine; resolve: (ok: boolean) => void }
  /** before running risky SQL; `expected` is the name to type when set */
  | { kind: 'guard'; source: string; production: boolean; statements: string[]; reasons: string[]; expected?: string; resolve: (ok: boolean) => void }

interface TreeState {
  children: Record<string, DbNode[] | undefined>
  loading: Record<string, boolean>
  errors: Record<string, string | undefined>
}

interface AppState extends TreeState {
  ready: boolean
  prefs: Prefs
  connections: ConnectionProfile[]
  tabs: TabState[]
  /** saved consoles of every data source (open or not) */
  consoles: ConsoleFile[]
  snippets: Snippet[]
  /** saved table filters (Views menu of the table editor) */
  views: SavedView[]
  /** editor split (one or two panes); `activeTabId` is always the focused pane's active tab */
  layout: PaneLayout
  keymap: KeymapState | null
  /** theme shown while browsing the theme picker (not saved) */
  themePreview?: string
  /** effective shortcuts (defaults + keymap overrides), canonical accelerators */
  bindings: Bindings
  activeTabId?: string
  recent: string[]
  expanded: string[]
  selectedNode?: string
  connected: Record<string, boolean>
  metadata: Record<string, CompletionMetadata | undefined>
  modal: Modal | null
  toasts: Toast[]
  notifications: Toast[]
  showExplorer: boolean
  /** per-tab "has unsaved state" flags (pending grid edits, open transactions) */
  dirty: Record<string, 'changes' | 'transaction' | undefined>
  /** queries running in tab sessions (status bar progress) */
  tasks: Tasks
  /** data sources whose hidden schemas are shown (dimmed) in the explorer, this run only */
  revealHidden: Record<string, boolean>
}

export const useApp = create<AppState>(() => ({
  ready: false,
  prefs: DEFAULT_PREFS,
  connections: [],
  tabs: [],
  consoles: [],
  snippets: [],
  views: [],
  layout: single(),
  keymap: null,
  bindings: effectiveBindings(undefined, IS_MAC),
  recent: [],
  expanded: [],
  connected: {},
  metadata: {},
  children: {},
  loading: {},
  errors: {},
  modal: null,
  toasts: [],
  notifications: [],
  showExplorer: true,
  dirty: {},
  tasks: {},
  revealHidden: {}
}))

const set = useApp.setState
const get = useApp.getState

// ---------- bootstrap & persistence ----------

export async function bootstrap(): Promise<void> {
  const [prefs, connections, session, savedConsoles, snippets, views] = await Promise.all([
    api.getPrefs(),
    api.listConnections(),
    api.getSession(),
    api.listConsoles(),
    api.getSnippets(),
    api.getViews()
  ])
  const ids = new Set(connections.map((c) => c.id))
  const migrated = migrateTabs(
    session.tabs.filter((t) => ids.has(t.connectionId)),
    savedConsoles.filter((c) => ids.has(c.connectionId)),
    newId,
    Date.now()
  )
  const tabs = migrated.tabs
  let layout = normalizeLayout(session.layout, tabs.map((t) => t.id))
  if (!session.layout && session.activeTabId) layout = layoutActivate(layout, session.activeTabId)
  set({
    prefs,
    connections,
    tabs,
    consoles: migrated.consoles,
    snippets,
    views,
    layout,
    activeTabId: activeOf(layout),
    expanded: session.expanded,
    ready: true
  })
  if (migrated.consoles.length !== savedConsoles.length) void api.saveConsoles(migrated.consoles)
  for (const key of session.expanded) void loadChildren(key)
  await loadKeymap()
}

/** First run: adopt the user's DataGrip keymap automatically when DataGrip is installed. */
async function loadKeymap(): Promise<void> {
  const saved = await api.getKeymap()
  if (saved) return applyKeymap(saved, false)
  try {
    const imported = await api.importDataGripKeymap()
    applyKeymap(imported.state, true)
    notify('success', `Shortcuts imported from ${imported.state.source} (${imported.mapped} actions).`)
  } catch {
    applyKeymap({ source: 'Tessera defaults', bindings: {} }, true)
  }
}

export function applyKeymap(state: KeymapState, persist = true): void {
  set({ keymap: state, bindings: effectiveBindings(state, IS_MAC) })
  if (persist) void api.setKeymap(state)
}

export async function importKeymapFromDataGrip(): Promise<void> {
  try {
    const imported = await api.importDataGripKeymap()
    applyKeymap(imported.state)
    notify('success', `Imported ${imported.mapped} shortcuts from ${imported.state.source}` + (imported.chordsSkipped ? ` (${imported.chordsSkipped} two-keystroke shortcuts are not supported).` : '.'))
  } catch (err) {
    notify('error', `Keymap import failed: ${errorMessage(err)}`)
  }
}

/** Label of an action's primary shortcut, e.g. "⌘⇧L". */
export function keyLabel(actionId: string): string {
  if (actionId === 'search.everywhere') return '⇧⇧'
  return accelLabel(get().bindings[actionId]?.[0], IS_MAC)
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let snippetTimer: ReturnType<typeof setTimeout> | undefined
/** Saves every view (main validates them again before writing views.json). */
export function saveViews(views: SavedView[]): void {
  set({ views })
  void api.saveViews(views).catch((err) => notify('error', `Views were not saved: ${errorMessage(err)}`))
}

/** Saves the whole list (debounced); main validates it again before writing snippets.json. */
export function saveSnippets(snippets: Snippet[]): void {
  set({ snippets })
  clearTimeout(snippetTimer)
  snippetTimer = setTimeout(() => void api.saveSnippets(useApp.getState().snippets).catch((err) => notify('error', `Snippets were not saved: ${errorMessage(err)}`)), 400)
}

let consoleTimer: ReturnType<typeof setTimeout> | undefined
useApp.subscribe((s, prev) => {
  if (!s.ready) return
  if (s.prefs !== prev.prefs) void api.setPrefs(s.prefs)
  if (s.tabs !== prev.tabs || s.layout !== prev.layout || s.expanded !== prev.expanded) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void api.setSession(sessionSnapshot()), 400)
  }
  if (s.consoles !== prev.consoles) {
    clearTimeout(consoleTimer)
    consoleTimer = setTimeout(() => void api.saveConsoles(get().consoles), 400)
  }
})

/** Synchronous final save while the window closes. */
export function flushSession(): void {
  clearTimeout(saveTimer)
  clearTimeout(consoleTimer)
  const { ready, consoles } = get()
  if (ready) api.flushSession(sessionSnapshot(), consoles)
}

function sessionSnapshot() {
  const { tabs, activeTabId, expanded, layout } = get()
  return { tabs, activeTabId, expanded, layout }
}

export const setPrefs = (patch: Partial<Prefs>) => set((s) => ({ prefs: { ...s.prefs, ...patch } }))

// ---------- notifications & modals ----------

export function notify(kind: Toast['kind'], message: string, action?: Toast['action']): void {
  const toast: Toast = { id: newId(), kind, message, at: Date.now(), action }
  set((s) => ({ toasts: [...s.toasts, toast], notifications: [toast, ...s.notifications].slice(0, 100) }))
  setTimeout(() => dismissToast(toast.id), kind === 'error' ? 8000 : 4000)
}
export const dismissToast = (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))

export const openModal = (modal: Modal) => set({ modal })
export const closeModal = () => set({ modal: null })

export function confirm(title: string, message: string, buttons: ConfirmButton[], detail?: string): Promise<string | null> {
  return new Promise((resolve) => set({ modal: { kind: 'confirm', title, message, detail, buttons, resolve } }))
}

export function askParams(names: string[], initial: Record<string, string>): Promise<Record<string, string | null> | null> {
  return new Promise((resolve) => set({ modal: { kind: 'params', names, initial, resolve } }))
}

/** engine: highlights the preview with that dialect's tokenizer */
export function reviewChanges(preview: string, production = false, engine?: Engine): Promise<boolean> {
  return new Promise((resolve) => set({ modal: { kind: 'changes', preview, production, engine, resolve } }))
}

/** Which data sources to run a statement on (multi-source run). */
export function pickConnections(selected: string[]): Promise<string[] | null> {
  return new Promise((resolve) => set({ modal: { kind: 'pickConnections', selected, resolve } }))
}

/** Asks before risky statements run (see shared/safety.ts); production may require typing the source name. */
export function guardRun(c: { typed: boolean; statements: string[]; reasons: string[] }, source: string, production: boolean): Promise<boolean> {
  return new Promise((resolve) =>
    set({ modal: { kind: 'guard', source, production, statements: c.statements, reasons: c.reasons, expected: c.typed ? source : undefined, resolve } })
  )
}

export function prompt(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => set({ modal: { kind: 'prompt', title, label, value, resolve } }))
}

// ---------- connections ----------

export const connectionById = (id: string | undefined) => get().connections.find((c) => c.id === id)

export async function refreshConnections(): Promise<void> {
  set({ connections: await api.listConnections() })
}

export async function saveConnection(input: ConnectionInput): Promise<ConnectionProfile> {
  const saved = await api.saveConnection(input)
  await refreshConnections()
  await refreshConnection(saved.id)
  return saved
}

/** Hides or unhides a schema of a data source. A cosmetic edit: sessions and transactions stay open. */
export async function hideSchema(connectionId: string, schema: string, hide: boolean): Promise<void> {
  const conn = connectionById(connectionId)
  if (!conn) return
  const { hasPassword: _hasPassword, ...profile } = conn
  try {
    await api.saveConnection({ ...profile, hiddenSchemas: setSchemaHidden(conn.hiddenSchemas, schema, hide) })
    await refreshConnections()
    // completion metadata is fetched without hidden schemas: an unhidden one needs a refetch
    if (!hide && get().metadata[connectionId]) void ensureMetadata(connectionId, true)
  } catch (err) {
    notify('error', errorMessage(err))
  }
}

export const toggleRevealHidden = (connectionId: string) => set((s) => ({ revealHidden: { ...s.revealHidden, [connectionId]: !s.revealHidden[connectionId] } }))

export async function deleteConnection(id: string): Promise<void> {
  await api.deleteConnection(id)
  set((s) => {
    const tabs = s.tabs.filter((t) => t.connectionId !== id)
    const layout = normalizeLayout(s.layout, tabs.map((t) => t.id))
    return {
      tabs,
      layout,
      activeTabId: activeOf(layout),
      expanded: s.expanded.filter((k) => !k.startsWith(id)),
      consoles: s.consoles.filter((c) => c.connectionId !== id),
      metadata: { ...s.metadata, [id]: undefined }
    }
  })
  await refreshConnections()
}

export function markConnected(id: string, on = true): void {
  if (!!get().connected[id] !== on) set((s) => ({ connected: { ...s.connected, [id]: on } }))
}

export async function disconnect(id: string): Promise<void> {
  await api.disconnect(id)
  markConnected(id, false)
  notify('info', `Disconnected from ${connectionById(id)?.name ?? 'data source'}`)
}

/**
 * Drops the cached tree for a data source and reloads what is expanded. Completion metadata is
 * reloaded in place: open consoles keep completing from the old copy until the new one arrives.
 */
export async function refreshConnection(id: string): Promise<void> {
  await api.refresh(id)
  const keys = Object.keys(get().children).filter((k) => k === id || k.startsWith(id + '::'))
  set((s) => {
    const children = { ...s.children }
    for (const k of keys) delete children[k]
    return { children }
  })
  for (const k of get().expanded.filter((k) => k === id || k.startsWith(id + '::'))) void loadChildren(k)
  if (get().metadata[id]) void ensureMetadata(id, true)
}

export async function ensureMetadata(id: string, force = false): Promise<CompletionMetadata | undefined> {
  const cached = get().metadata[id]
  if (cached && !force) return cached
  try {
    const md = await api.metadata(id)
    set((s) => ({ metadata: { ...s.metadata, [id]: md } }))
    markConnected(id)
    return md
  } catch (err) {
    notify('error', `Introspection failed: ${errorMessage(err)}`)
    return undefined
  }
}

// ---------- tree ----------

/** Tree keys: connection id for roots, `${connectionId}::${node.id}` for database objects. */
export const nodeKey = (connectionId: string, node: DbNode) => `${connectionId}::${node.id}`
export const keyConnection = (key: string) => key.split('::')[0]

export function findNode(key: string): DbNode | undefined {
  for (const list of Object.values(get().children)) {
    const n = list?.find((x) => nodeKey(keyConnection(key), x) === key)
    if (n) return n
  }
  return undefined
}

export async function loadChildren(key: string): Promise<void> {
  const connectionId = keyConnection(key)
  if (!connectionById(connectionId) || get().loading[key]) return
  const node = key === connectionId ? null : findNode(key)
  if (key !== connectionId && !node) return
  set((s) => ({ loading: { ...s.loading, [key]: true }, errors: { ...s.errors, [key]: undefined } }))
  try {
    const nodes = await api.listChildren(connectionId, node?.path ?? null)
    set((s) => ({ children: { ...s.children, [key]: nodes } }))
    markConnected(connectionId)
    // restore deeper expansion once parents are known
    for (const k of get().expanded) if (nodes.some((n) => nodeKey(connectionId, n) === k) && !get().children[k]) void loadChildren(k)
  } catch (err) {
    set((s) => ({ errors: { ...s.errors, [key]: errorMessage(err) } }))
  } finally {
    set((s) => ({ loading: { ...s.loading, [key]: false } }))
  }
}

export function toggleExpanded(key: string, open?: boolean): void {
  const isOpen = get().expanded.includes(key)
  const next = open ?? !isOpen
  if (next === isOpen) return
  // descendants keep their own expansion, so re-opening a node restores its subtree
  set((s) => ({ expanded: next ? [...s.expanded, key] : s.expanded.filter((k) => k !== key) }))
  if (next && !get().children[key]) void loadChildren(key)
}

export const selectNode = (key: string | undefined) => set({ selectedNode: key })

// ---------- tabs ----------

export const activeTab = () => get().tabs.find((t) => t.id === get().activeTabId)

const withLayout = (layout: PaneLayout) => ({ layout, activeTabId: activeOf(layout) })

export function activate(id: string): void {
  set((s) => ({ ...withLayout(layoutActivate(s.layout, id)), recent: [id, ...s.recent.filter((r) => r !== id)] }))
}

/** New tabs open in the focused split, like DataGrip. */
function addTab(tab: TabState): void {
  set((s) => ({ tabs: [...s.tabs, tab], ...withLayout(layoutAdd(s.layout, tab.id)) }))
  activate(tab.id)
}

// ---------- split editor ----------

export function focusPane(i: number): void {
  const { layout } = get()
  if (layout.focused !== i) set(withLayout(layoutFocus(layout, i)))
}

export const setSplitRatio = (ratio: number) => set((s) => ({ layout: { ...s.layout, ratio: Math.min(0.85, Math.max(0.15, ratio)) } }))

/** Split Right/Down: moves the tab to the other side; a lone console gets a fresh console beside it. */
export function splitTab(orientation: PaneLayout['orientation'], tabId = get().activeTabId): void {
  const { layout, tabs } = get()
  if (!tabId) return
  if (layout.panes.length === 2) {
    if (layout.orientation !== orientation) set({ layout: { ...layout, orientation } })
    return moveTabToOtherSplit(tabId)
  }
  const tab = tabs.find((t) => t.id === tabId)
  if (layout.panes[0].tabIds.length < 2) {
    if (tab?.kind !== 'console') return notify('info', 'Open another tab to split the editor.')
    const created = openConsole(tab.connectionId)
    set((s) => withLayout(moveToOtherPane(s.layout, created, orientation)))
    return
  }
  set((s) => withLayout(moveToOtherPane(s.layout, tabId, orientation)))
}

export function moveTabToOtherSplit(tabId = get().activeTabId): void {
  if (!tabId) return
  const { layout } = get()
  const next = moveToOtherPane(layout, tabId, layout.orientation)
  if (next === layout) return notify('info', 'The last tab of a split cannot be moved out of it.')
  set(withLayout(next))
}

export const unsplitPanes = () => set((s) => withLayout(layoutUnsplit(s.layout)))

export function cycleSplit(delta: 1 | -1): void {
  const { layout } = get()
  if (layout.panes.length === 2) focusPane((layout.focused + delta + 2) % 2)
}

export function updateTab(id: string, patch: Partial<TabState>): void {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as TabState) : t)) }))
}

// ---------- saved consoles ----------

export const consoleById = (id: string) => get().consoles.find((c) => c.id === id)

/** A data source's consoles, most recently edited first. */
export const consolesOf = (connectionId: string, consoles = get().consoles) =>
  consoles.filter((c) => c.connectionId === connectionId).sort((a, b) => b.updatedAt - a.updatedAt)

/** Creates a saved console ("console", "console_1"…) and opens it. Returns the tab id. */
export function openConsole(connectionId: string, text = '', opts: { name?: string; schema?: string } = {}): string {
  const file: ConsoleFile = {
    id: newId(),
    connectionId,
    name: opts.name ?? nextConsoleName(consolesOf(connectionId).map((c) => c.name)),
    text,
    schema: opts.schema,
    updatedAt: Date.now()
  }
  set((s) => ({ consoles: [...s.consoles, file] }))
  return openSavedConsole(file.id)!
}

/** Focuses the console's tab, reopening it if it was closed. */
export function openSavedConsole(consoleId: string): string | undefined {
  const file = consoleById(consoleId)
  if (!file) return undefined
  const open = get().tabs.find((t) => t.kind === 'console' && t.consoleId === consoleId)
  if (open) {
    activate(open.id)
    return open.id
  }
  const id = newId()
  addTab({ kind: 'console', id, connectionId: file.connectionId, title: file.name, consoleId, autoCommit: true })
  return id
}

export function updateConsole(consoleId: string, patch: Partial<Omit<ConsoleFile, 'id'>>): void {
  set((s) => ({
    consoles: s.consoles.map((c) => (c.id === consoleId ? { ...c, ...patch, updatedAt: 'text' in patch ? Date.now() : c.updatedAt } : c)),
    tabs:
      patch.name !== undefined || patch.connectionId !== undefined
        ? s.tabs.map((t) =>
            t.kind === 'console' && t.consoleId === consoleId
              ? { ...t, title: patch.name ?? t.title, connectionId: patch.connectionId ?? t.connectionId }
              : t
          )
        : s.tabs
  }))
}

export async function renameConsole(consoleId: string): Promise<void> {
  const file = consoleById(consoleId)
  if (!file) return
  const name = (await prompt('Rename console', 'Name', file.name))?.trim()
  if (!name || name === file.name) return
  if (consolesOf(file.connectionId).some((c) => c.name === name && c.id !== consoleId)) {
    return notify('error', `A console named "${name}" already exists for this data source.`)
  }
  updateConsole(consoleId, { name })
}

export async function deleteConsole(consoleId: string): Promise<void> {
  const file = consoleById(consoleId)
  if (!file) return
  const ok = await confirm('Delete console', `Delete "${file.name}" and its contents? This cannot be undone.`, [
    { label: 'Delete', value: 'ok', danger: true },
    { label: 'Cancel', value: 'cancel', primary: true }
  ])
  if (ok !== 'ok') return
  const tab = get().tabs.find((t) => t.kind === 'console' && t.consoleId === consoleId)
  if (tab) await closeTab(tab.id)
  if (tab && get().tabs.some((t) => t.id === tab.id)) return // closing was cancelled (open transaction)
  set((s) => ({ consoles: s.consoles.filter((c) => c.id !== consoleId) }))
}

export function openTable(connectionId: string, schema: string, table: string, where?: string): void {
  const existing = get().tabs.find((t) => t.kind === 'table' && t.connectionId === connectionId && t.schema === schema && t.table === table)
  if (existing && !where) return activate(existing.id)
  if (existing) {
    updateTab(existing.id, { where })
    return activate(existing.id)
  }
  addTab({ kind: 'table', id: newId(), connectionId, title: table, schema, table, where })
}

export function openDdl(connectionId: string, title: string, text: string): void {
  addTab({ kind: 'ddl', id: newId(), connectionId, title, text })
}

export const beginTask = (tabId: string, label: string) => set((s) => ({ tasks: startTask(s.tasks, { tabId, label, startedAt: Date.now() }) }))
export const advanceTask = (tabId: string, n: number, total: number) => set((s) => ({ tasks: stepTask(s.tasks, tabId, n, total) }))
export const finishTask = (tabId: string) => set((s) => ({ tasks: endTask(s.tasks, tabId) }))

export const setDirty = (id: string, state: AppState['dirty'][string]) =>
  set((s) => (s.dirty[id] === state ? s : { dirty: { ...s.dirty, [id]: state } }))

/** Tabs with debounced editor state register a synchronous flush here. */
export const tabFlushers = new Map<string, () => void>()

export async function closeTab(id: string): Promise<void> {
  const tab = get().tabs.find((t) => t.id === id)
  if (!tab) return
  tabFlushers.get(id)?.() // keystrokes from the last 300 ms must count before we decide anything
  const dirty = get().dirty[id]
  if (dirty === 'transaction') {
    const choice = await confirm('Close console', 'This console has an open transaction.', [
      { label: 'Commit', value: 'commit', primary: true },
      { label: 'Rollback', value: 'rollback', danger: true },
      { label: 'Cancel', value: 'cancel' }
    ])
    if (!choice || choice === 'cancel') return
    const res = choice === 'commit' ? await api.commit(id) : await api.rollback(id)
    if (res.error) return notify('error', res.error.message)
  } else if (dirty === 'changes') {
    const choice = await confirm('Close table', 'Discard pending changes?', [
      { label: 'Discard', value: 'discard', danger: true },
      { label: 'Cancel', value: 'cancel', primary: true }
    ])
    if (choice !== 'discard') return
  }
  void api.closeSession(id)
  // closed consoles stay saved (DataGrip behaviour) — except blank ones, which would only clutter the list
  if (tab.kind === 'console' && !consoleById(tab.consoleId)?.text.trim()) {
    set((s) => ({ consoles: s.consoles.filter((c) => c.id !== tab.consoleId) }))
  }
  set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id)
    const recent = s.recent.filter((r) => r !== id)
    return { tabs, recent, ...withLayout(layoutRemove(s.layout, id, recent)), dirty: { ...s.dirty, [id]: undefined } }
  })
}

/** Next/previous tab within the focused split. */
export function cycleTab(delta: 1 | -1): void {
  const { layout } = get()
  const ids = layout.panes[layout.focused]?.tabIds ?? []
  if (!ids.length) return
  const i = ids.indexOf(activeOf(layout) ?? '')
  activate(ids[(i + delta + ids.length) % ids.length])
}
