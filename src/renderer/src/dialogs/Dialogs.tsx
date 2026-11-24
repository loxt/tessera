import { useEffect, useMemo, useState } from 'react'
import { clampFontSize, clampLineHeight, stepFontSize } from '@shared/editorFont'
import { connectionAccent } from '@shared/environment'
import { EXPORT_FORMATS, exportResult, withExportExtension, type ExportFormat } from '@shared/export'
import type { ExportProgress } from '@shared/model'
import { paramLabel } from '@shared/sql'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { closeModal, keyLabel, notify, setPrefs, useApp, type Modal as ModalState } from '../store'
import { CommandPalette } from './CommandPalette'
import { ConnectionDialog } from './ConnectionDialog'
import { HistoryDialog } from './HistoryDialog'
import { JsonDialog } from './JsonDialog'
import { SchemaDiffDialog } from './SchemaDiffDialog'
import { DiagramDialog } from './DiagramDialog'
import { ImportDialog } from './ImportDialog'
import { KeymapPanel, recorder } from './KeymapPanel'
import { SnippetsPanel } from './SnippetsPanel'
import { SqlPreview } from '../components/SqlPreview'
import { ThemeSwatch } from '../components/ThemeSwatch'
import { LEGACY_THEME_IDS, THEMES, themeById } from '@shared/themes'

export function Modal({
  title,
  onClose,
  wide,
  children,
  footer,
  className = ''
}: {
  title?: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recorder.active) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && <div className="dialog-head">{title}</div>}
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

function ConfirmDialog({ m }: { m: Extract<ModalState, { kind: 'confirm' }> }) {
  const done = (v: string | null) => {
    closeModal()
    m.resolve(v)
  }
  const primary = m.buttons.find((b) => b.primary)
  return (
    <Modal
      title={m.title}
      onClose={() => done(null)}
      footer={m.buttons.map((b) => (
        <button key={b.value} autoFocus={b.primary} className={`btn ${b.primary ? 'primary' : 'outline'}${b.danger ? ' danger' : ''}`} onClick={() => done(b.value)}>
          {b.label}
        </button>
      ))}
    >
      <div className="dialog-body" onKeyDown={(e) => e.key === 'Enter' && primary && done(primary.value)}>
        <div>{m.message}</div>
        {m.detail && <pre className="preview mono" style={{ marginTop: 8 }}>{m.detail}</pre>}
      </div>
    </Modal>
  )
}

function ParamsDialog({ m }: { m: Extract<ModalState, { kind: 'params' }> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(m.names.map((n) => [n, m.initial[n] ?? ''])))
  const [nulls, setNulls] = useState<Record<string, boolean>>({})
  const done = (ok: boolean) => {
    closeModal()
    m.resolve(ok ? Object.fromEntries(m.names.map((n) => [n, nulls[n] ? null : values[n]])) : null)
  }
  return (
    <Modal
      title="Query parameters"
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn outline" onClick={() => done(false)}>Cancel</button>
          <button className="btn primary" onClick={() => done(true)}>Execute</button>
        </>
      }
    >
      <form className="dialog-body form" onSubmit={(e) => (e.preventDefault(), done(true))}>
        {m.names.map((n, i) => (
          <div key={n} style={{ display: 'contents' }}>
            <label className="mono">{paramLabel(n)}</label>
            <div className="row">
              <input className="input mono" autoFocus={i === 0} disabled={nulls[n]} value={values[n]} onChange={(e) => setValues({ ...values, [n]: e.target.value })} />
              <label className="small" style={{ textAlign: 'left' }}>
                <input type="checkbox" checked={!!nulls[n]} onChange={(e) => setNulls({ ...nulls, [n]: e.target.checked })} /> NULL
              </label>
            </div>
          </div>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function PromptDialog({ m }: { m: Extract<ModalState, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(m.value)
  const done = (v: string | null) => {
    closeModal()
    m.resolve(v)
  }
  return (
    <Modal
      title={m.title}
      onClose={() => done(null)}
      footer={
        <>
          <button className="btn outline" onClick={() => done(null)}>Cancel</button>
          <button className="btn primary" disabled={!value.trim()} onClick={() => done(value)}>OK</button>
        </>
      }
    >
      <form className="dialog-body form" onSubmit={(e) => (e.preventDefault(), value.trim() && done(value))}>
        <label>{m.label}</label>
        <input className="input" autoFocus value={value} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(e.target.value)} />
      </form>
    </Modal>
  )
}

function PickConnectionsDialog({ m }: { m: Extract<ModalState, { kind: 'pickConnections' }> }) {
  const connections = useApp((s) => s.connections)
  const [picked, setPicked] = useState(() => new Set(m.selected))
  const done = (ids: string[] | null) => {
    closeModal()
    m.resolve(ids)
  }
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))
  return (
    <Modal
      title="Run on several data sources"
      onClose={() => done(null)}
      footer={
        <>
          <span className="left muted small">Each one gets its own result tab. Read-only statements only.</span>
          <button className="btn" onClick={() => done(null)}>Cancel</button>
          <button className="btn primary" disabled={picked.size === 0} onClick={() => done(connections.filter((c) => picked.has(c.id)).map((c) => c.id))}>
            Run on {picked.size}
          </button>
        </>
      }
    >
      <div className="dialog-body pick-list">
        {connections.map((c) => (
          <label key={c.id} className="cf-item">
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="dot" style={{ background: connectionAccent(c) ?? 'var(--faint)' }} />
            <span className="grow">{c.name}</span>
            <span className="muted small">{c.engine}</span>
          </label>
        ))}
      </div>
    </Modal>
  )
}

function ProductionNote() {
  return (
    <div className="prod-note">
      <Icon name="alert" /> This is a <b>Production</b> data source: real customers see these changes.
    </div>
  )
}

/** Confirmation before risky SQL runs: what will run, why it is risky, and (in production) the name to type. */
function GuardDialog({ m }: { m: Extract<ModalState, { kind: 'guard' }> }) {
  const [typed, setTyped] = useState('')
  const ok = !m.expected || typed.trim() === m.expected
  const done = (run: boolean) => {
    closeModal()
    m.resolve(run)
  }
  const dangerous = m.reasons.length > 0
  return (
    <Modal
      title={dangerous ? 'This statement changes a lot' : 'Run in Production?'}
      wide
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn outline" autoFocus={!m.expected} onClick={() => done(false)}>Cancel</button>
          <button className={`btn primary${dangerous ? ' danger' : ''}`} disabled={!ok} onClick={() => done(true)}>
            Run {m.statements.length === 1 ? 'statement' : `${m.statements.length} statements`}
          </button>
        </>
      }
    >
      <form className="dialog-body fields" onSubmit={(e) => (e.preventDefault(), ok && done(true))}>
        {m.production && <ProductionNote />}
        {m.reasons.map((r) => (
          <div key={r} className="guard-reason">
            <Icon name="alert" /> {r}
          </div>
        ))}
        <pre className="preview mono">{m.statements.join(';\n\n')}</pre>
        {m.expected && (
          <div className="field">
            <label className="lbl" htmlFor="guard-name">
              Type <span className="mono">{m.expected}</span> to run it
            </label>
            <input id="guard-name" className="input" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
      </form>
    </Modal>
  )
}

function ChangesDialog({ m }: { m: Extract<ModalState, { kind: 'changes' }> }) {
  const done = (ok: boolean) => {
    closeModal()
    m.resolve(ok)
  }
  return (
    <Modal
      title="Submit changes"
      wide
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn outline" onClick={() => done(false)}>Cancel</button>
          <button className="btn primary" autoFocus onClick={() => done(true)}>Submit</button>
        </>
      }
    >
      <div className="dialog-body">
        {m.production && <ProductionNote />}
        <div className="muted small" style={{ marginBottom: 6 }}>These statements will run in one transaction:</div>
        {m.engine ? <SqlPreview sql={m.preview} engine={m.engine} /> : <pre className="preview mono">{m.preview}</pre>}
      </div>
    </Modal>
  )
}

const FONT_PREVIEW = `select o.id, o.total >= 100 as big
from orders o
where o.status != 'cancelled'
  and o.created_at::date <= now() -- ligatures: >= != :: <= ->`

/** Editor → Font, like DataGrip: JetBrains Mono, size, line height, ligatures, with a live preview. */
function EditorFontSettings() {
  const prefs = useApp((s) => s.prefs)
  const size = prefs.editorFontSize
  return (
    <>
      <label htmlFor="font-size">Editor font</label>
      <div className="row">
        <button className="btn outline icon" aria-label="Decrease font size" disabled={size <= clampFontSize(0)} onClick={() => setPrefs({ editorFontSize: stepFontSize(size, -1) })}>
          <Icon name="minus" />
        </button>
        <input id="font-size" className="input num" type="number" min={8} max={40} value={size} onChange={(e) => setPrefs({ editorFontSize: clampFontSize(Number(e.target.value)) })} style={{ width: 72, flex: 'none', textAlign: 'center' }} />
        <button className="btn outline icon" aria-label="Increase font size" disabled={size >= clampFontSize(999)} onClick={() => setPrefs({ editorFontSize: stepFontSize(size, 1) })}>
          <Icon name="plus" />
        </button>
        <span className="muted small">JetBrains Mono · {keyLabel('view.fontIncrease') || 'View menu'} / {keyLabel('view.fontDecrease') || ''}</span>
      </div>
      <label htmlFor="font-line">Line height</label>
      <div className="row">
        <input id="font-line" className="input num" type="number" min={1} max={2.5} step={0.1} value={prefs.editorLineHeight} onChange={(e) => setPrefs({ editorLineHeight: clampLineHeight(Number(e.target.value)) })} style={{ width: 72, flex: 'none', textAlign: 'center' }} />
        <span className="muted small">times the font size</span>
      </div>
      <label style={{ alignSelf: 'start', paddingTop: 4 }}>Ligatures</label>
      <div className="font-ligatures">
        <div className="row">
          <button className="switch" role="switch" aria-checked={prefs.editorLigatures} aria-label="Font ligatures" onClick={() => setPrefs({ editorLigatures: !prefs.editorLigatures })} />
          <span className="muted small">Draw -&gt; &gt;= != :: as single glyphs</span>
        </div>
        <pre
        className="font-preview"
        aria-label="Font preview"
        style={{ fontSize: size, lineHeight: prefs.editorLineHeight, fontFeatureSettings: prefs.editorLigatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0' }}
      >
        {FONT_PREVIEW}
      </pre>
      </div>
    </>
  )
}

/** Settings → General → AI assistant: where Claude Code is, and whether it starts. */
function AiSettings() {
  const path = useApp((s) => s.prefs.claudePath)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | 'checking' | null>(null)
  const check = async () => {
    setStatus('checking')
    try {
      const st = await api.aiStatus()
      setStatus(st.available ? { ok: true, text: `${st.version} · ${st.path}` } : { ok: false, text: st.error ?? 'Not available' })
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) })
    }
  }
  return (
    <>
      <label htmlFor="claude-path">AI assistant</label>
      <div className="row">
        <input id="claude-path" className="input mono" placeholder="Claude Code is found automatically" value={path} onChange={(e) => setPrefs({ claudePath: e.target.value.trim() })} />
        <button className="btn outline" onClick={() => void check()} disabled={status === 'checking'}>
          Check
        </button>
      </div>
      <span />
      <span className={`small ${status && status !== 'checking' ? (status.ok ? 'test-result ok' : 'test-result err') : 'muted'}`} style={{ whiteSpace: 'normal' }}>
        {status === 'checking' ? 'Checking…' : status ? status.text : 'Uses your Claude Code login (no API key in Tessera). Leave empty unless Claude Code lives somewhere unusual; the file must be named claude.'}
      </span>
    </>
  )
}

function SettingsDialog({ initialTab = 'general', snippetDraft }: { initialTab?: 'general' | 'keymap' | 'snippets'; snippetDraft?: string }) {
  const prefs = useApp((s) => s.prefs)
  const [tab, setTab] = useState(initialTab)
  return (
    <Modal title="Settings" wide onClose={closeModal} footer={<button className="btn primary" onClick={closeModal}>Done</button>}>
      <div className="dialog-tabs">
        <div className="seg">
          <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>General</button>
          <button className={tab === 'keymap' ? 'on' : ''} onClick={() => setTab('keymap')}>Keymap</button>
          <button className={tab === 'snippets' ? 'on' : ''} onClick={() => setTab('snippets')}>Snippets</button>
        </div>
      </div>
      {tab === 'keymap' ? (
        <div className="dialog-body"><KeymapPanel /></div>
      ) : tab === 'snippets' ? (
        <div className="dialog-body"><SnippetsPanel draft={snippetDraft} /></div>
      ) : (
      <div className="dialog-body form">
        <label style={{ alignSelf: 'start', paddingTop: 6 }}>Theme</label>
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {[{ id: 'system', name: 'System' }, ...THEMES].map((t) => {
            const theme = themeById(t.id === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'tessera-graphite' : 'tessera-paper') : t.id)!
            const on = prefs.theme === t.id || LEGACY_THEME_IDS[prefs.theme] === t.id
            return (
              <button key={t.id} role="radio" aria-checked={on} className={`theme-card${on ? ' on' : ''}`} onClick={() => setPrefs({ theme: t.id })}>
                <ThemeSwatch theme={theme} />
                <span className="theme-name">{t.id === 'system' ? 'System (follows macOS)' : t.name}</span>
              </button>
            )
          })}
        </div>
        <EditorFontSettings />
        <AiSettings />
        <label>Result page size</label>
        <div className="row">
          <input className="input" type="number" min={10} max={100000} value={prefs.pageSize} onChange={(e) => setPrefs({ pageSize: Math.min(100000, Math.max(10, Number(e.target.value) || 10)) })} style={{ width: 100, flex: 'none' }} />
          <span className="muted small">rows fetched per query / table page</span>
        </div>
        <label>System schemas</label>
        <label style={{ textAlign: 'left', color: 'inherit' }}>
          <input type="checkbox" checked={prefs.showSystemSchemas} onChange={(e) => setPrefs({ showSystemSchemas: e.target.checked })} /> Show pg_catalog, information_schema, mysql, sys…
        </label>
      </div>
      )}
    </Modal>
  )
}

/** Rows read so far against the count; without a count (or before the first batch) the bar is indeterminate. */
function ExportProgressBar({ p }: { p: ExportProgress | null }) {
  const total = p?.total ?? null
  const pct = p && total ? Math.min(100, Math.floor((p.read / total) * 100)) : null
  return (
    <div className="export-progress" role="status" aria-live="polite">
      <progress max={100} value={pct ?? undefined} aria-label="Export progress" />
      <span className="small">
        {!p ? (
          'Starting…'
        ) : (
          <>
            {pct !== null && <strong>{pct}% · </strong>}
            {p.read.toLocaleString()}
            {total !== null ? ` of ${total.toLocaleString()}` : ''} rows
            {p.written !== p.read ? ` · ${p.written.toLocaleString()} match the filter` : ''}
          </>
        )}
      </span>
    </div>
  )
}

/** folder of the last export in this run, so the next one starts there */
let lastExportDir: string | undefined
const extOf = (format: ExportFormat) => EXPORT_FORMATS.find((f) => f.id === format)!.ext
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

function ExportDialog({ m }: { m: Extract<ModalState, { kind: 'export' }> }) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [table, setTable] = useState(m.table ?? 'my_table')
  const text = useMemo(() => exportResult(m.result, format, { table, engine: m.engine }), [m.result, format, table, m.engine])
  const ext = extOf(format)
  const [path, setPath] = useState(() => (lastExportDir ? `${lastExportDir}/${m.table ?? 'result'}.${extOf('csv')}` : ''))
  const [pathError, setPathError] = useState<string | null>(null)
  /** the typed path names an existing file: the next Save replaces it */
  const [replacing, setReplacing] = useState<string | null>(null)
  /** picked in the native dialog, which already asked about replacing */
  const [picked, setPicked] = useState<string | null>(null)
  const editPath = (next: string) => {
    setPath(next)
    setPathError(null)
    setReplacing(null)
  }
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  useEffect(() => {
    if (!m.source) return
    const id = m.source.sessionId
    return api.onExportProgress((p) => p.sessionId === id && setProgress(p))
  }, [m.source])
  // like DataGrip: the preview shows the loaded page; with a source, main re-runs the query and streams every row
  const opts = { table, engine: m.engine }
  const pending = async <T,>(work: () => Promise<T>) => {
    setProgress(null)
    setBusy(true)
    try {
      return await work()
    } finally {
      setBusy(false)
    }
  }
  const name = `${m.table ?? 'result'}.${ext}`
  /** typed path → checked path (undefined: ask with the native dialog); null stops: invalid, or confirm replacing first */
  const target = async (): Promise<string | undefined | null> => {
    if (!path.trim()) return undefined
    try {
      const checked = await api.checkSavePath(path)
      if (checked.exists && checked.path !== replacing && checked.path !== picked) {
        setReplacing(checked.path)
        return null
      }
      return checked.path
    } catch (err) {
      setPathError(errorMessage(err))
      return null
    }
  }
  const save = async () => {
    const to = await target()
    if (to === null) return null
    const source = m.source
    const res = source ? await pending(() => api.exportToFile(source, format, opts, name, to)) : await api.saveFile(name, text, to)
    if (!res) return null
    const saved = typeof res === 'string' ? res : res.path
    lastExportDir = folderOf(saved)
    return typeof res === 'string' ? saved : `${res.rows.toLocaleString()} rows to ${saved}`
  }
  const browse = async () => {
    const chosen = await api.chooseSavePath(path.trim() || name)
    if (!chosen) return
    editPath(chosen)
    setPicked(chosen)
  }
  const n = m.result.rows.length.toLocaleString()
  return (
    <Modal
      title={m.source ? 'Export all rows' : `Export ${n} rows`}
      wide
      onClose={closeModal}
      footer={
        <>
          {busy && m.source && (
            <button className="btn" onClick={() => void api.cancel(m.source!.sessionId)}>
              Cancel Export
            </button>
          )}
          <button
            className="btn outline"
            disabled={busy}
            onClick={() => {
              const source = m.source
              void (source ? pending(() => api.exportToText(source, format, opts)) : Promise.resolve(text))
                .then((t) => api.copyText(t))
                .then(() => (closeModal(), notify('success', 'Copied to clipboard')))
                .catch((err) => notify('error', errorMessage(err)))
            }}
          >
            Copy to Clipboard
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              try {
                const done = await save()
                if (done) {
                  closeModal()
                  notify('success', `Exported ${done}`)
                }
              } catch (err) {
                notify('error', errorMessage(err))
              }
            }}
          >
            {busy ? 'Exporting…' : replacing ? 'Replace' : path.trim() ? 'Save' : 'Save to File…'}
          </button>
        </>
      }
    >
      <div className="dialog-body form">
        {(m.source || m.result.hasMore) && (
          <>
            <span />
            <span className="muted small">
              {m.source
                ? `${n} rows are loaded; the export runs the query again without the page limit and writes every row to the file as it arrives.`
                : `Only the ${n} loaded rows are exported: this statement is not read-only, so it is not re-run.`}
            </span>
          </>
        )}
        {busy && m.source && (
          <>
            <label>Progress</label>
            <ExportProgressBar p={progress} />
          </>
        )}
        <label>Format</label>
        <select
          className="input"
          value={format}
          onChange={(e) => {
            const next = e.target.value as ExportFormat
            setFormat(next)
            if (path) editPath(withExportExtension(path, extOf(next)))
          }}
        >
          {EXPORT_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        {format === 'sql' && (
          <>
            <label>Table name</label>
            <input className="input mono" value={table} onChange={(e) => setTable(e.target.value)} />
          </>
        )}
        <label htmlFor="export-path">File</label>
        <div className="row">
          <input
            id="export-path"
            className="input mono"
            placeholder={`Paste a path, e.g. ~/Downloads/${name} — or Browse…`}
            value={path}
            disabled={busy}
            spellCheck={false}
            aria-invalid={pathError !== null}
            aria-describedby="export-path-note"
            onChange={(e) => editPath(e.target.value)}
          />
          <button type="button" className="btn outline" disabled={busy} onClick={() => void browse().catch((err) => notify('error', errorMessage(err)))}>
            Browse…
          </button>
        </div>
        <span id="export-path-note" className={`full small ${pathError ? 'field-error' : replacing ? 'field-warn' : 'muted'}`} role={pathError || replacing ? 'alert' : undefined}>
          {pathError ?? (replacing ? `${replacing.split('/').pop()} already exists in that folder — Replace overwrites it.` : 'Empty: Save asks where to save.')}
        </span>
        <label style={{ alignSelf: 'start' }}>Preview</label>
        <pre className="preview mono" style={{ margin: 0, maxHeight: '35vh' }}>{text.slice(0, 4000)}{text.length > 4000 ? '\n…' : ''}</pre>
      </div>
    </Modal>
  )
}

function NotificationsDialog() {
  const items = useApp((s) => s.notifications)
  return (
    <Modal title="Notifications" wide onClose={closeModal} footer={<button className="btn primary" onClick={closeModal}>Close</button>}>
      <div className="dialog-body" style={{ maxHeight: '60vh' }}>
        {items.length === 0 && <div className="muted">Nothing yet.</div>}
        {items.map((n) => (
          <div key={n.id} className="history-item" style={{ maxHeight: 'none' }}>
            <div className="meta">{new Date(n.at).toLocaleTimeString()} · {n.kind}</div>
            {n.message}
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function ModalHost() {
  const m = useApp((s) => s.modal)
  if (!m) return null
  switch (m.kind) {
    case 'confirm': return <ConfirmDialog m={m} />
    case 'params': return <ParamsDialog m={m} />
    case 'changes': return <ChangesDialog m={m} />
    case 'guard': return <GuardDialog m={m} />
    case 'pickConnections': return <PickConnectionsDialog m={m} />
    case 'settings': return <SettingsDialog initialTab={m.tab} snippetDraft={m.snippetDraft} />
    case 'history': return <HistoryDialog m={m} />
    case 'json': return <JsonDialog m={m} />
    case 'schemaDiff': return <SchemaDiffDialog />
    case 'import': return <ImportDialog m={m} />
    case 'diagram': return <DiagramDialog connectionId={m.connectionId} schema={m.schema} table={m.table} />
    case 'export': return <ExportDialog m={m} />
    case 'notifications': return <NotificationsDialog />
    case 'connection': return <ConnectionDialog initial={m.initial} editId={m.editId} />
    case 'palette': return <CommandPalette mode={m.mode} connectionId={m.connectionId} />
    case 'prompt': return <PromptDialog m={m} />
  }
}
