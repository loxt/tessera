import type {
  CompletionMetadata,
  ConsoleFile,
  ConnectionInput,
  ConnectionProfile,
  DbNode,
  ExecOptions,
  ExecResult,
  ExportProgress,
  ExportSource,
  HistoryEntry,
  ObjectPath,
  PlanNode,
  Prefs,
  SessionState,
  TableInfo,
  TableQuery,
  TestResult
} from './model'
import type { ChangeSet } from './dml'
import type { KeymapState } from './keymap'
import type { ExportFormat, ExportOptions } from './export'
import type { Snippet } from './snippets'
import type { SavedView } from './views'
import type { ImportCell } from './importData'
import type { AiInput, AiKind } from './ai'

export interface AiStatus {
  available: boolean
  path?: string
  version?: string
  error?: string
}

export interface AiResult {
  ok: boolean
  text: string
  error?: string
  costUsd?: number
  durationMs: number
}

/**
 * The complete renderer → main contract, exposed as `window.tessera`.
 * Every method maps 1:1 to an `ipcMain.handle(<name>)` channel (see main/ipc.ts).
 */
export interface TesseraApi {
  // connection profiles
  listConnections(): Promise<ConnectionProfile[]>
  saveConnection(input: ConnectionInput): Promise<ConnectionProfile>
  deleteConnection(id: string): Promise<void>
  /** Copies a profile including its stored secret (which the renderer cannot see). */
  duplicateConnection(id: string): Promise<ConnectionProfile>
  testConnection(input: ConnectionInput): Promise<TestResult>

  // introspection (shared metadata session per connection)
  listChildren(connectionId: string, path: ObjectPath | null): Promise<DbNode[]>
  tableInfo(connectionId: string, schema: string, table: string): Promise<TableInfo>
  ddl(connectionId: string, kind: string, schema: string, name: string): Promise<string>
  metadata(connectionId: string): Promise<CompletionMetadata>
  refresh(connectionId: string): Promise<void>
  disconnect(connectionId: string): Promise<void>

  // per-tab sessions
  execute(sessionId: string, connectionId: string, sql: string, opts: ExecOptions): Promise<ExecResult>
  cancel(sessionId: string): Promise<void>
  closeSession(sessionId: string): Promise<void>
  setAutoCommit(sessionId: string, connectionId: string, autoCommit: boolean): Promise<boolean>
  commit(sessionId: string): Promise<ExecResult>
  rollback(sessionId: string): Promise<ExecResult>
  tableData(sessionId: string, connectionId: string, q: TableQuery): Promise<ExecResult>
  countRows(sessionId: string, connectionId: string, q: TableQuery): Promise<number>
  applyChanges(sessionId: string, connectionId: string, changes: ChangeSet): Promise<ExecResult>
  explain(sessionId: string, connectionId: string, sql: string, analyze: boolean, schema?: string): Promise<PlanNode[]>

  // persistence
  getPrefs(): Promise<Prefs>
  setPrefs(prefs: Prefs): Promise<void>
  getSession(): Promise<SessionState>
  setSession(state: SessionState): Promise<void>
  /** null until the user (or the first-run import) saved a keymap */
  getKeymap(): Promise<KeymapState | null>
  setKeymap(state: KeymapState): Promise<void>
  importDataGripKeymap(): Promise<{ state: KeymapState; mapped: number; chordsSkipped: number }>
  listConsoles(): Promise<ConsoleFile[]>
  saveConsoles(consoles: ConsoleFile[]): Promise<void>
  /** one data source's history, or all of them (newest first) for null */
  history(connectionId: string | null): Promise<HistoryEntry[]>
  clearHistory(connectionId: string): Promise<void>
  getSnippets(): Promise<Snippet[]>
  saveSnippets(snippets: Snippet[]): Promise<void>
  getViews(): Promise<SavedView[]>
  /** asks for a CSV/TSV/XLSX file and returns its sheets as plain cells; null when cancelled */
  readImportFile(): Promise<{ fileName: string; sheets: { name: string; rows: ImportCell[][] }[] } | null>
  saveViews(views: SavedView[]): Promise<void>

  // AI assistant (local Claude Code, the user's own login)
  aiStatus(): Promise<AiStatus>
  /** streams the answer through onAiText; never runs SQL */
  aiRun(requestId: string, kind: AiKind, input: AiInput): Promise<AiResult>
  aiCancel(requestId: string): Promise<void>

  /** every table of a schema, fully described (columns, keys, indexes), for schema compare */
  schemaSnapshot(connectionId: string, schema: string): Promise<TableInfo[]>

  // OS integration
  /** Writes to `path` when given (see checkSavePath), otherwise to a file the user picks; null when the dialog is cancelled. */
  saveFile(defaultName: string, content: string, path?: string): Promise<string | null>
  /** Re-runs `source` and streams every row into `path`, or a file the user picks; null when the dialog is cancelled. */
  exportToFile(source: ExportSource, format: ExportFormat, opts: ExportOptions, defaultName: string, path?: string): Promise<{ path: string; rows: number } | null>
  /** Native save dialog, starting at `defaultPath` (a file name or an absolute path); null when cancelled. */
  chooseSavePath(defaultPath: string): Promise<string | null>
  /** Resolves a typed/pasted path (~, quotes, file://) and checks its folder exists; throws a readable message otherwise. */
  checkSavePath(path: string): Promise<{ path: string; exists: boolean }>
  /** Writes through the main process, so it needs no renderer permission, focus or user activation. */
  copyText(text: string): Promise<void>
  /** Same as exportToFile, into a string (clipboard). */
  exportToText(source: ExportSource, format: ExportFormat, opts: ExportOptions): Promise<string>
  /** Shows an open dialog; `read` also returns the file's UTF-8 content. */
  openFile(filters: { name: string; extensions: string[] }[], read: boolean): Promise<{ path: string; content?: string } | null>
  onAction(cb: (actionId: string) => void): () => void
  /** progress of the running exportToFile/exportToText, per session (throttled) */
  onExportProgress(cb: (p: ExportProgress & { sessionId: string }) => void): () => void
  /** pieces of an AI answer as Claude writes them */
  onAiText(cb: (p: { requestId: string; text: string }) => void): () => void
  /** Synchronous save used while the window unloads, when async IPC may never complete. */
  flushSession(state: SessionState, consoles: ConsoleFile[]): void
}

export type ApiMethod = Exclude<keyof TesseraApi, 'onAction' | 'onExportProgress' | 'onAiText' | 'flushSession'>

/** Every invoke channel; preload exposes exactly these, main must implement all of them. */
export const API_METHODS: ApiMethod[] = [
  'listConnections', 'saveConnection', 'deleteConnection', 'duplicateConnection', 'testConnection',
  'listChildren', 'tableInfo', 'ddl', 'metadata', 'refresh', 'disconnect',
  'execute', 'cancel', 'closeSession', 'setAutoCommit', 'commit', 'rollback',
  'tableData', 'countRows', 'applyChanges', 'explain',
  'getPrefs', 'setPrefs', 'getSession', 'setSession', 'getKeymap', 'setKeymap', 'importDataGripKeymap', 'listConsoles', 'saveConsoles', 'history', 'clearHistory', 'getSnippets', 'saveSnippets', 'getViews', 'saveViews', 'readImportFile', 'aiStatus', 'aiRun', 'aiCancel', 'schemaSnapshot',
  'saveFile', 'openFile', 'copyText', 'chooseSavePath', 'checkSavePath', 'exportToFile', 'exportToText'
]
