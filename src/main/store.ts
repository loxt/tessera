import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  DEFAULT_PREFS,
  type ConnectionInput,
  type ConsoleFile,
  type ConnectionProfile,
  type Engine,
  type HistoryEntry,
  type Prefs,
  type SessionState,
  type SslMode
} from '@shared/model'
import { clampFontSize, clampLineHeight } from '@shared/editorFont'
import { isEnvironment } from '@shared/environment'
import { mergeHistory } from '@shared/history'
import type { KeymapState } from '@shared/keymap'
import { DEFAULT_SNIPPETS, sanitizeSnippets, type Snippet } from '@shared/snippets'
import { sanitizeViews, type SavedView } from '@shared/views'
import { LEGACY_THEME_IDS, THEME_IDS } from '@shared/themes'
import type { ResolvedProfile } from './db/types'

const dir = () => {
  const d = join(app.getPath('userData'), 'lattice')
  mkdirSync(d, { recursive: true, mode: 0o700 })
  return d
}

/**
 * Missing file → fallback. Unparseable file → moved aside as `<name>.corrupt-<ts>` (never
 * silently overwritten by the next save, which would wipe saved connections).
 */
function readJson<T>(name: string, fallback: T): T {
  const file = join(dir(), name)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
  try {
    return JSON.parse(text) as T
  } catch {
    const aside = `${file}.corrupt-${Date.now()}`
    renameSync(file, aside)
    console.error(`[tessera] ${name} was unreadable and has been moved to ${aside}`)
    return fallback
  }
}

/** Atomic write: a crash mid-write never leaves a truncated file behind. */
function writeJson(name: string, value: unknown): void {
  const file = join(dir(), name)
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(file + '.tmp', file)
}

type StoredConnection = Omit<ConnectionProfile, 'hasPassword'> & { secret?: string }

const ENGINES: Engine[] = ['postgres', 'mysql', 'sqlite']
const optionalString = (v: unknown, field: string) => {
  if (v !== undefined && typeof v !== 'string') throw new Error(`Invalid ${field}`)
}

/** Validates renderer-supplied profiles at the IPC trust boundary. */
export function validateConnectionInput(input: ConnectionInput): void {
  if (!input || typeof input !== 'object') throw new Error('Invalid connection')
  if (!ENGINES.includes(input.engine)) throw new Error(`Unsupported engine: ${String(input.engine)}`)
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Name is required')
  for (const f of ['id', 'group', 'color', 'host', 'database', 'user', 'file'] as const) optionalString(input[f], f)
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    throw new Error('Port must be between 1 and 65535')
  }
  if (input.engine === 'sqlite' && !input.file?.trim()) throw new Error('Database file is required')
  if (input.engine !== 'sqlite' && !input.host?.trim()) throw new Error('Host is required')
  if (input.password !== undefined && input.password !== null && typeof input.password !== 'string') {
    throw new Error('Invalid password')
  }
  if (input.ssl !== undefined && !SSL_MODES.includes(input.ssl)) throw new Error('Invalid SSL mode')
  if (input.readOnly !== undefined && typeof input.readOnly !== 'boolean') throw new Error('Invalid read-only flag')
  if (input.environment !== undefined && !isEnvironment(input.environment)) throw new Error('Invalid environment')
  const hidden: unknown = input.hiddenSchemas
  if (hidden !== undefined && (!Array.isArray(hidden) || hidden.length > MAX_HIDDEN_SCHEMAS || hidden.some((s) => typeof s !== 'string' || !s || s.length > MAX_NAME_LENGTH))) {
    throw new Error('Invalid hidden schemas')
  }
}

const MAX_HIDDEN_SCHEMAS = 10_000
const MAX_NAME_LENGTH = 1_000

const SSL_MODES: SslMode[] = ['disable', 'prefer', 'require', 'verify-full']

/** Copies only known profile fields, so arbitrary renderer keys never reach disk or drivers. */
function pickProfile(input: ConnectionInput): Omit<ConnectionProfile, 'hasPassword'> {
  const { id = '', name, engine, group, color, environment, host, port, database, user, file, ssl, readOnly, hiddenSchemas } = input
  return { id, name: name.trim(), engine, group, color, environment, host, port, database, user, file, ssl, readOnly, hiddenSchemas: hiddenSchemas?.length ? [...hiddenSchemas] : undefined }
}

/** On Linux without a keyring, safeStorage "encrypts" with a hard-coded key; treat that as unavailable. */
const canEncrypt = () =>
  safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')

/**
 * The Keychain key belongs to the app name, so passwords saved while the app was called Lattice
 * may no longer decrypt. Say what to do instead of surfacing a bare crypto error.
 */
function decryptSecret(secret: string, name: string): string {
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch (err) {
    console.error(`[tessera] saved password for "${name}" could not be decrypted`, err)
    throw new Error(`The saved password for "${name}" can't be read anymore. Open its properties (⌘I) and enter it again.`)
  }
}

export class ConnectionStore {
  private items: StoredConnection[] = readJson('connections.json', [])
  /** Secrets kept only in memory when the OS keychain is unavailable. */
  private volatileSecrets = new Map<string, string>()

  list(): ConnectionProfile[] {
    return this.items.map(({ secret, ...p }) => ({ ...p, hasPassword: !!secret || this.volatileSecrets.has(p.id) }))
  }

  save(input: ConnectionInput): ConnectionProfile {
    validateConnectionInput(input)
    const { password } = input
    const profile = pickProfile(input)
    const id = profile.id || randomUUID()
    const existing = this.items.find((c) => c.id === id)
    let secret = existing?.secret
    if (password === null || password === '') {
      secret = undefined
      this.volatileSecrets.delete(id)
    } else if (typeof password === 'string') {
      if (canEncrypt()) secret = safeStorage.encryptString(password).toString('base64')
      else this.volatileSecrets.set(id, password)
    }
    const stored: StoredConnection = { ...profile, id, secret }
    this.items = existing ? this.items.map((c) => (c.id === id ? stored : c)) : [...this.items, stored]
    writeJson('connections.json', this.items)
    return this.list().find((c) => c.id === id)!
  }

  duplicate(id: string): ConnectionProfile {
    const src = this.items.find((c) => c.id === id)
    if (!src) throw new Error('Data source not found')
    const copy: StoredConnection = { ...src, id: randomUUID(), name: `${src.name} (copy)` }
    const volatile = this.volatileSecrets.get(id)
    if (volatile) this.volatileSecrets.set(copy.id, volatile)
    this.items = [...this.items, copy]
    writeJson('connections.json', this.items)
    return this.list().find((c) => c.id === copy.id)!
  }

  delete(id: string): void {
    this.items = this.items.filter((c) => c.id !== id)
    this.volatileSecrets.delete(id)
    writeJson('connections.json', this.items)
  }

  resolve(id: string): ResolvedProfile {
    const stored = this.items.find((c) => c.id === id)
    if (!stored) throw new Error('Data source not found')
    const { secret, ...p } = stored
    const password = secret ? decryptSecret(secret, p.name) : this.volatileSecrets.get(id)
    return { ...p, hasPassword: !!password, password }
  }

  /** For "Test Connection" on unsaved edits: falls back to the stored secret when the field was left untouched. */
  resolveInput(input: ConnectionInput): ResolvedProfile {
    validateConnectionInput(input)
    const { password } = input
    const p = pickProfile(input)
    const stored = input.id && password === undefined ? this.resolve(input.id).password : undefined
    const pw = typeof password === 'string' ? password : stored
    return { ...p, id: p.id || 'test', hasPassword: !!pw, password: pw }
  }
}

const HISTORY_CAP = 500

/** Keeps only known pref keys whose type matches the default. */
function sanitizePrefs(p: unknown): Prefs {
  const src = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  const out = { ...DEFAULT_PREFS } as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_PREFS)) if (typeof src[k] === typeof out[k]) out[k] = src[k]
  if (![...THEME_IDS, ...Object.keys(LEGACY_THEME_IDS)].includes(out.theme as string)) out.theme = DEFAULT_PREFS.theme
  out.editorFontSize = clampFontSize(out.editorFontSize as number)
  out.editorLineHeight = clampLineHeight(out.editorLineHeight as number)
  return out as unknown as Prefs
}

const TAB_KINDS = new Set(['console', 'table', 'ddl'])
function sanitizeSession(s: unknown): SessionState {
  const src = (s && typeof s === 'object' ? s : {}) as Partial<SessionState>
  const tabs = Array.isArray(src.tabs)
    ? src.tabs.filter((t) => t && typeof t === 'object' && TAB_KINDS.has(t.kind) && typeof t.id === 'string' && typeof t.connectionId === 'string' && typeof t.title === 'string')
    : []
  const expanded = Array.isArray(src.expanded) ? src.expanded.filter((k): k is string => typeof k === 'string') : []
  return { tabs, expanded, activeTabId: typeof src.activeTabId === 'string' ? src.activeTabId : undefined, layout: sanitizeLayout(src.layout) }
}

function sanitizeLayout(l: unknown): SessionState['layout'] {
  if (!l || typeof l !== 'object') return undefined
  const src = l as Record<string, unknown>
  if (!Array.isArray(src.panes) || src.panes.length < 1 || src.panes.length > 2) return undefined
  const panes = src.panes.map((p) => {
    const pane = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    return {
      tabIds: Array.isArray(pane.tabIds) ? pane.tabIds.filter((x): x is string => typeof x === 'string') : [],
      activeId: typeof pane.activeId === 'string' ? pane.activeId : undefined
    }
  })
  const ratio = typeof src.ratio === 'number' && src.ratio > 0.1 && src.ratio < 0.9 ? src.ratio : 0.5
  return { panes, focused: src.focused === 1 && panes.length === 2 ? 1 : 0, orientation: src.orientation === 'column' ? 'column' : 'row', ratio }
}

const MAX_CONSOLE_CHARS = 5_000_000

function sanitizeConsoles(list: unknown): ConsoleFile[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.connectionId === 'string' && typeof c.name === 'string' && typeof c.text === 'string')
    .map((c) => ({
      id: c.id,
      connectionId: c.connectionId,
      name: c.name.slice(0, 200),
      text: c.text.slice(0, MAX_CONSOLE_CHARS),
      schema: typeof c.schema === 'string' ? c.schema : undefined,
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now()
    }))
}

function sanitizeKeymap(k: unknown): KeymapState {
  const src = (k && typeof k === 'object' ? k : {}) as Partial<KeymapState>
  const bindings: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(src.bindings ?? {})) {
    if (Array.isArray(list)) bindings[id] = list.filter((a): a is string => typeof a === 'string' && a.length < 64)
  }
  return { source: typeof src.source === 'string' ? src.source : undefined, bindings }
}

export const persistence = {
  getKeymap: (): KeymapState | null => {
    const raw = readJson<unknown>('keymap.json', null)
    return raw === null ? null : sanitizeKeymap(raw)
  },
  setKeymap: (k: unknown) => writeJson('keymap.json', sanitizeKeymap(k)),
  getConsoles: (): ConsoleFile[] => sanitizeConsoles(readJson('consoles.json', [])),
  setConsoles: (list: unknown) => writeJson('consoles.json', sanitizeConsoles(list)),
  deleteConsolesOf(connectionId: string): void {
    writeJson('consoles.json', this.getConsoles().filter((c) => c.connectionId !== connectionId))
  },
  getPrefs: (): Prefs => sanitizePrefs(readJson('prefs.json', {})),
  setPrefs: (p: unknown) => writeJson('prefs.json', sanitizePrefs(p)),
  getSession: (): SessionState => sanitizeSession(readJson('session.json', {})),
  setSession: (s: unknown) => writeJson('session.json', sanitizeSession(s)),
  getWindow: () => readJson<{ x?: number; y?: number; width: number; height: number; maximized?: boolean }>('window.json', { width: 1440, height: 900 }),
  setWindow: (w: unknown) => writeJson('window.json', w),

  /** one data source, or every data source (newest first) when connectionId is null */
  history(connectionId: string | null): HistoryEntry[] {
    const all = readJson<Record<string, HistoryEntry[]>>('history.json', {})
    return connectionId === null ? mergeHistory(all) : (all[connectionId] ?? [])
  },
  addHistory(entry: HistoryEntry): void {
    const all = readJson<Record<string, HistoryEntry[]>>('history.json', {})
    const list = (all[entry.connectionId] ?? []).filter((h) => h.sql !== entry.sql)
    writeJson('history.json', { ...all, [entry.connectionId]: [entry, ...list].slice(0, HISTORY_CAP) })
  },
  clearHistory(connectionId: string): void {
    const { [connectionId]: _, ...rest } = readJson<Record<string, HistoryEntry[]>>('history.json', {})
    writeJson('history.json', rest)
  },
  /** the built-in set until the user saves their own list */
  getSnippets: (): Snippet[] => {
    const raw = readJson<unknown>('snippets.json', null)
    return raw === null ? DEFAULT_SNIPPETS : sanitizeSnippets(raw)
  },
  setSnippets: (list: unknown) => writeJson('snippets.json', sanitizeSnippets(list)),
  getViews: (): SavedView[] => sanitizeViews(readJson('views.json', [])),
  setViews: (list: unknown) => writeJson('views.json', sanitizeViews(list))
}
