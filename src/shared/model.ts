// Domain model shared by main and renderer. Everything here must be structured-clone safe.
import type { Environment } from './environment'

export type Engine = 'postgres' | 'mysql' | 'sqlite'
/**
 * libpq semantics: `require` encrypts without checking the certificate;
 * `verify-full` checks the CA chain and the host name.
 */
export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-full'

export interface ConnectionProfile {
  id: string
  name: string
  engine: Engine
  group?: string
  color?: string
  /** local / staging / production; colors the data source and guards production */
  environment?: Environment
  host?: string
  port?: number
  database?: string
  user?: string
  /** SQLite database file */
  file?: string
  ssl?: SslMode
  readOnly?: boolean
  /** schemas left out of the explorer, completion and search (like DataGrip's schema selection) */
  hiddenSchemas?: string[]
  /** Renderer never receives the secret itself */
  hasPassword: boolean
}

/** password: undefined = keep stored secret, null = clear it, string = replace it */
export type ConnectionInput = Omit<ConnectionProfile, 'hasPassword'> & { password?: string | null }

export interface BinaryValue {
  $t: 'binary'
  hex: string
  size: number
}
/** Exact numerics (bigint/numeric) and temporal values travel as strings to stay lossless. */
export type CellValue = null | string | number | boolean | BinaryValue

export interface ColumnMeta {
  name: string
  type: string
}

export interface ResultSet {
  columns: ColumnMeta[]
  rows: CellValue[][]
  /** true when the fetch limit cut the result */
  hasMore: boolean
}

export interface DbError {
  message: string
  code?: string
  /** 1-based character offset into the executed SQL (PostgreSQL only) */
  position?: number
  detail?: string
  hint?: string
}

export interface ExecResult {
  sql: string
  durationMs: number
  /** session transaction state after execution */
  inTransaction: boolean
  result?: ResultSet
  affected?: number
  command?: string
  error?: DbError
}

export interface ExecOptions {
  limit?: number
  params?: CellValue[]
  schema?: string
}

export type NodeKind =
  | 'schema'
  | 'folder'
  | 'table'
  | 'view'
  | 'routine'
  | 'sequence'
  | 'column'
  | 'index'
  | 'key'
  | 'fk'

export type FolderKind = 'tables' | 'views' | 'routines' | 'sequences' | 'columns' | 'keys' | 'fks' | 'indexes'

export interface ObjectPath {
  schema?: string
  folder?: FolderKind
  table?: string
}

export interface DbNode {
  id: string
  kind: NodeKind
  name: string
  path: ObjectPath
  hasChildren: boolean
  detail?: string
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default: string | null
  autoIncrement: boolean
}

export interface ForeignKeyInfo {
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

export interface TableInfo {
  schema: string
  name: string
  kind: 'table' | 'view'
  columns: ColumnInfo[]
  primaryKey: string[]
  foreignKeys: ForeignKeyInfo[]
  indexes: IndexInfo[]
  /** SQLite tables without a declared PK are edited through rowid */
  rowid?: boolean
}

export interface CompletionTable {
  schema: string
  name: string
  kind: 'table' | 'view'
  columns: string[]
}

/** A foreign key as completion sees it: table.columns reference refTable.refColumns, in key order. */
export interface CompletionFk {
  schema: string
  table: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

export interface CompletionMetadata {
  defaultSchema: string
  schemas: string[]
  tables: CompletionTable[]
  /** drives JOIN … ON suggestions; absent from adapters that cannot list them */
  foreignKeys?: CompletionFk[]
}

export interface TableQuery {
  schema: string
  table: string
  where?: string
  orderBy?: string
  /** omitted = every row (export) */
  limit?: number
  offset: number
}

/** What an export re-runs to fetch every row: like DataGrip, the grid only holds a page. */
export type ExportSource = { sessionId: string; connectionId: string } & (
  /** filter: the results grid's quick filter, applied to each streamed batch */
  | { kind: 'sql'; sql: string; params?: CellValue[]; schema?: string; filter?: string }
  /** the table editor's query; its limit and offset are ignored */
  | { kind: 'table'; query: TableQuery }
)

/** read: rows fetched so far; written: those that passed the quick filter; total: null when it couldn't be counted */
export interface ExportProgress {
  read: number
  written: number
  total: number | null
}

export interface PlanNode {
  label: string
  detail?: string
  cost?: number
  rows?: number
  time?: number
  children: PlanNode[]
}

export interface TestResult {
  ok: boolean
  version?: string
  ms: number
  error?: DbError
}

export interface HistoryEntry {
  connectionId: string
  sql: string
  at: number
  durationMs: number
  ok: boolean
  /** rows returned, or rows affected by DML */
  rows?: number
  /** first line of the server error, so failed queries can be searched by it */
  error?: string
}

/** a theme id from shared/themes.ts, or 'system' to follow macOS */
export type ThemePref = string

export interface Prefs {
  theme: ThemePref
  editorFontSize: number
  /** multiple of the font size, like DataGrip's Editor → Font → Line height */
  editorLineHeight: number
  /** JetBrains Mono ligatures (->, >=, !=, ::) */
  editorLigatures: boolean
  /** Claude Code executable for the AI assistant; empty = find it */
  claudePath: string
  pageSize: number
  showSystemSchemas: boolean
  explorerWidth: number
  resultsHeight: number
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  editorFontSize: 13,
  editorLineHeight: 1.2,
  editorLigatures: true,
  claudePath: '',
  pageSize: 10,
  showSystemSchemas: false,
  explorerWidth: 280,
  resultsHeight: 320
}

/** A saved query console. Like DataGrip, consoles belong to a data source and outlive their tabs. */
export interface ConsoleFile {
  id: string
  connectionId: string
  name: string
  text: string
  schema?: string
  updatedAt: number
}

export type TabState =
  | { kind: 'console'; id: string; connectionId: string; title: string; consoleId: string; autoCommit: boolean }
  | { kind: 'table'; id: string; connectionId: string; title: string; schema: string; table: string; where?: string }
  | { kind: 'ddl'; id: string; connectionId: string; title: string; text: string }

/** Editor split: one or two panes, each with its own tab order and active tab. */
export interface PaneLayout {
  panes: { tabIds: string[]; activeId?: string }[]
  focused: number
  orientation: 'row' | 'column'
  /** size of the first pane, 0..1 */
  ratio: number
}

export interface SessionState {
  tabs: TabState[]
  activeTabId?: string
  expanded: string[]
  layout?: PaneLayout
}
