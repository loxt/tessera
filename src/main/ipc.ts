import { readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute } from 'node:path'
import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { API_METHODS, type ApiMethod, type TesseraApi } from '@shared/api'
import { EXPORT_FORMATS, type ExportFormat, type ExportOptions } from '@shared/export'
import { DEFAULT_PREFS, type ExportSource, type Prefs } from '@shared/model'
import { buildPrompt, type AiInput, type AiKind } from '@shared/ai'
import { aiStatus, cancelAi, runAi } from './ai'
import { exportToFile, exportToText, type OnProgress } from './export'
import { readImportFile } from './importFile'
import { ConnectionStore, persistence } from './store'
import { SessionManager, toDbError } from './sessions'
import { importDataGripKeymap } from './keymap-import'
import { resolveTypedPath } from './paths'

type Handlers = Omit<TesseraApi, 'onAction' | 'onExportProgress' | 'onAiText' | 'flushSession'>

const MAX_COMPARE_TABLES = 3000
const AI_KINDS: AiKind[] = ['ask', 'explain', 'fix', 'plan']
const AI_FIELD_MAX = 200_000

function validAiKind(kind: unknown): AiKind {
  if (!AI_KINDS.includes(kind as AiKind)) throw new Error('Invalid AI request')
  return kind as AiKind
}

/** Only known string fields, bounded, from the renderer into the prompt. */
function validAiInput(input: unknown): AiInput {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (!['postgres', 'mysql', 'sqlite'].includes(src.engine as string)) throw new Error('Invalid engine')
  const field = (k: string) => {
    const v = src[k]
    if (v === undefined) return undefined
    if (typeof v !== 'string' || v.length > AI_FIELD_MAX) throw new Error(`Invalid ${k}`)
    return v
  }
  return { engine: src.engine as AiInput['engine'], schema: field('schema') ?? '', question: field('question'), sql: field('sql'), error: field('error'), plan: field('plan') }
}

const assertId = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !v || v.length > 200) throw new Error(`Invalid ${what}`)
}

const MAX_OPEN_BYTES = 20 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 100

const FORMATS = new Set<unknown>(EXPORT_FORMATS.map((f) => f.id))
const ENGINES = new Set<unknown>(['postgres', 'mysql', 'sqlite'])

function checkExport(source: ExportSource, format: unknown): asserts format is ExportFormat {
  if (!FORMATS.has(format)) throw new Error('Invalid export format')
  if (!source || typeof source !== 'object') throw new Error('Invalid export source')
  assertId(source.sessionId, 'session')
  assertId(source.connectionId, 'connection')
  const optional = (v: unknown) => v === undefined || typeof v === 'string'
  const ok =
    (source.kind === 'sql' &&
      typeof source.sql === 'string' &&
      (source.params === undefined || Array.isArray(source.params)) &&
      optional(source.schema) &&
      optional(source.filter)) ||
    (source.kind === 'table' &&
      typeof source.query?.schema === 'string' &&
      typeof source.query?.table === 'string' &&
      optional(source.query.where) &&
      optional(source.query.orderBy))
  // checked before the save dialog, so a bad request never touches the disk
  if (!ok) throw new Error('Invalid export source')
}

const exportOpts = (o: ExportOptions | undefined): ExportOptions => ({
  table: typeof o?.table === 'string' ? o.table : undefined,
  engine: ENGINES.has(o?.engine) ? o!.engine : undefined
})

/** Only our own renderer (dev server or packaged file://) may call the API. */
function trustedSender(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? frameUrl.startsWith(dev) : frameUrl.startsWith('file://')
}

export function registerIpc(getWindow: () => BrowserWindow | null, onKeymapChange: () => void): SessionManager {
  const connections = new ConnectionStore()
  const sessions = new SessionManager((id) => connections.resolve(id))
  const prefs = () => persistence.getPrefs()
  // one batch can take microseconds (SQLite); the bar doesn't need more than ~10 updates a second
  const progressFor = (sessionId: string): OnProgress => {
    let last = 0
    return (p) => {
      const now = Date.now()
      if (now - last < PROGRESS_INTERVAL_MS && p.read !== p.total) return
      last = now
      getWindow()?.webContents.send('exportProgress', { sessionId, ...p })
    }
  }
  const pickSavePath = async (defaultName: unknown): Promise<string | null> => {
    const win = getWindow()
    const name = String(defaultName)
    const defaultPath = isAbsolute(name) ? name : basename(name)
    const res = win ? await dialog.showSaveDialog(win, { defaultPath }) : await dialog.showSaveDialog({ defaultPath })
    return res.canceled || !res.filePath ? null : res.filePath
  }

  const checkSavePath = async (input: string) => {
    const path = resolveTypedPath(input, homedir())
    const [file, dir] = await Promise.all([stat(path).catch(() => null), stat(dirname(path)).catch(() => null)])
    if (file?.isDirectory()) throw new Error(`${path} is a folder — add a file name`)
    if (!dir?.isDirectory()) throw new Error(`Folder not found: ${dirname(path)}`)
    return { path, exists: file !== null }
  }
  /** an explicit path is re-checked here: the renderer's earlier check proves nothing */
  const savePath = async (defaultName: string, path: string | undefined) => (path === undefined ? pickSavePath(defaultName) : (await checkSavePath(path)).path)

  const handlers: Handlers = {
    listConnections: async () => connections.list(),
    saveConnection: async (input) => {
      const before = connections.list().find((c) => c.id === input.id)
      const saved = connections.save(input)
      // cosmetic edits (name, folder, color) must not kill open sessions and their transactions
      const relevant = (['engine', 'host', 'port', 'database', 'user', 'file', 'ssl', 'readOnly'] as const).some((k) => before?.[k] !== saved[k])
      if (!before || relevant || typeof input.password === 'string' || input.password === null) await sessions.disconnect(saved.id)
      return saved
    },
    duplicateConnection: async (id) => connections.duplicate(id),
    deleteConnection: async (id) => {
      await sessions.disconnect(id)
      connections.delete(id)
      persistence.clearHistory(id)
      persistence.deleteConsolesOf(id)
    },
    testConnection: async (input) => {
      try {
        return await sessions.test(connections.resolveInput(input))
      } catch (err) {
        return { ok: false, ms: 0, error: toDbError(err) }
      }
    },

    listChildren: (id, path) => sessions.meta(id, (a, s) => a.listChildren(s, path, prefs().showSystemSchemas)),
    tableInfo: (id, schema, table) => sessions.tableInfo(id, schema, table),
    ddl: (id, kind, schema, name) => sessions.meta(id, (a, s) => a.ddl(s, kind, schema, name)),
    metadata: (id) => sessions.meta(id, (a, s) => a.metadata(s, prefs().showSystemSchemas, connections.list().find((c) => c.id === id)?.hiddenSchemas)),
    refresh: async (id) => sessions.invalidate(id),
    disconnect: (id) => sessions.disconnect(id),

    execute: async (sessionId, connectionId, sql, opts) => {
      assertId(sessionId, 'session')
      const res = await sessions.execute(sessionId, connectionId, sql, opts)
      // statements that likely carry credentials never reach history.json
      if (!/\b(password|identified\s+by)\b/i.test(sql)) {
        persistence.addHistory({
          connectionId,
          sql,
          at: Date.now(),
          durationMs: Math.round(res.durationMs),
          ok: !res.error,
          rows: res.result?.rows.length ?? res.affected,
          error: res.error?.message.split('\n')[0].slice(0, 300)
        })
      }
      return res
    },
    cancel: (sessionId) => sessions.cancel(sessionId),
    closeSession: (sessionId) => sessions.closeSession(sessionId),
    setAutoCommit: (sessionId, connectionId, on) => sessions.setAutoCommit(sessionId, connectionId, on),
    commit: (sessionId) => sessions.endTransaction(sessionId, 'COMMIT'),
    rollback: (sessionId) => sessions.endTransaction(sessionId, 'ROLLBACK'),
    tableData: (sessionId, connectionId, q) => sessions.tableData(sessionId, connectionId, q),
    countRows: (sessionId, connectionId, q) => sessions.countRows(sessionId, connectionId, q),
    applyChanges: (sessionId, connectionId, changes) => sessions.applyChanges(sessionId, connectionId, changes),
    explain: (sessionId, connectionId, sql, analyze, schema) => sessions.explain(sessionId, connectionId, sql, analyze, schema),

    getPrefs: async () => prefs(),
    setPrefs: async (p: Prefs) => persistence.setPrefs({ ...DEFAULT_PREFS, ...p }),
    getSession: async () => persistence.getSession(),
    setSession: async (s) => persistence.setSession(s),
    getKeymap: async () => persistence.getKeymap(),
    setKeymap: async (state) => {
      persistence.setKeymap(state)
      onKeymapChange()
    },
    importDataGripKeymap: () => importDataGripKeymap(),
    listConsoles: async () => persistence.getConsoles(),
    saveConsoles: async (list) => persistence.setConsoles(list),
    history: async (id) => {
      if (id !== null) assertId(id, 'connection')
      return persistence.history(id)
    },
    aiStatus: () => aiStatus(prefs().claudePath || undefined),
    aiRun: async (requestId, kind, input) => {
      assertId(requestId, 'request')
      const { system, user } = buildPrompt(validAiKind(kind), validAiInput(input))
      return runAi(requestId, system, user, (text) => getWindow()?.webContents.send('aiText', { requestId, text }), prefs().claudePath || undefined)
    },
    aiCancel: async (requestId) => {
      assertId(requestId, 'request')
      cancelAi(requestId)
    },
    schemaSnapshot: async (id, schema) => {
      assertId(id, 'connection')
      if (typeof schema !== 'string' || !schema) throw new Error('Invalid schema')
      sessions.invalidate(id) // compare what the database has now, not a cached description
      const md = await sessions.meta(id, (a, s) => a.metadata(s, prefs().showSystemSchemas))
      const names = md.tables.filter((t) => t.schema === schema && t.kind === 'table').map((t) => t.name)
      if (names.length > MAX_COMPARE_TABLES) throw new Error(`${schema} has ${names.length} tables; compare works up to ${MAX_COMPARE_TABLES}`)
      const out = []
      for (const name of names) out.push(await sessions.tableInfo(id, schema, name))
      return out
    },
    getSnippets: async () => persistence.getSnippets(),
    getViews: async () => persistence.getViews(),
    readImportFile: async () => {
      const win = getWindow()
      const opts = { properties: ['openFile' as const], filters: [{ name: 'Spreadsheets', extensions: ['csv', 'tsv', 'txt', 'xlsx'] }] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      const path = res.filePaths[0]
      return res.canceled || !path ? null : readImportFile(path)
    },
    saveViews: async (list) => persistence.setViews(list),
    saveSnippets: async (list) => persistence.setSnippets(list),
    clearHistory: async (id) => persistence.clearHistory(id),

    saveFile: async (defaultName, content, explicitPath) => {
      if (typeof content !== 'string') throw new Error('Invalid content')
      const path = await savePath(defaultName, explicitPath)
      if (path) await writeFile(path, content, 'utf8')
      return path
    },
    chooseSavePath: async (defaultPath) => pickSavePath(defaultPath),
    checkSavePath: async (path) => checkSavePath(path),
    copyText: async (text) => {
      if (typeof text !== 'string') throw new Error('Invalid content')
      clipboard.writeText(text)
    },
    exportToFile: async (source, format, opts, defaultName, explicitPath) => {
      checkExport(source, format)
      const path = await savePath(defaultName, explicitPath)
      return path ? { path, rows: await exportToFile(sessions, source, format, exportOpts(opts), path, progressFor(source.sessionId)) } : null
    },
    exportToText: async (source, format, opts) => {
      checkExport(source, format)
      return exportToText(sessions, source, format, exportOpts(opts), progressFor(source.sessionId))
    },
    openFile: async (filters, read) => {
      const win = getWindow()
      const safeFilters = Array.isArray(filters)
        ? filters.map((f) => ({ name: String(f.name), extensions: Array.isArray(f.extensions) ? f.extensions.map(String) : ['*'] }))
        : undefined
      const opts = { properties: ['openFile' as const], filters: safeFilters }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      const path = res.filePaths[0]
      if (res.canceled || !path) return null
      if (!read) return { path }
      if ((await stat(path)).size > MAX_OPEN_BYTES) throw new Error('File is larger than 20 MB')
      return { path, content: await readFile(path, 'utf8') }
    }
  }

  ipcMain.on('flushSession', (event, state, consoles) => {
    try {
      if (trustedSender(event.senderFrame?.url)) {
        persistence.setSession(state)
        if (consoles !== undefined) persistence.setConsoles(consoles)
      }
    } finally {
      event.returnValue = true
    }
  })

  for (const name of API_METHODS) {
    const fn = handlers[name] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(name satisfies ApiMethod, (event, ...args: unknown[]) => {
      if (!trustedSender(event.senderFrame?.url)) throw new Error('Untrusted sender')
      return fn(...args)
    })
  }
  return sessions
}
