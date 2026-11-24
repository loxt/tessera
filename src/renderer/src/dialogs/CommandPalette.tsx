import { useEffect, useMemo, useRef, useState } from 'react'
import { ACTIONS } from '@shared/actions'
import { dispatch, hasHandler } from '../actions'
import { Icon } from '../components/Icon'
import { activate, activeTab, closeModal, connectionById, consolesOf, ensureMetadata, keyLabel, openConsole, openSavedConsole, openTable, setPrefs, useApp } from '../store'
import { visibleMetadata } from '../schemas'
import { Modal } from './Dialogs'
import { SqlPreview } from '../components/SqlPreview'
import { ThemeSwatch } from '../components/ThemeSwatch'
import type { Engine } from '@shared/model'
import { environmentLabel } from '@shared/environment'
import { THEMES, themeById } from '@shared/themes'

/** what the side pane shows for the highlighted result */
type Preview =
  | { kind: 'table'; title: string; subtitle: string; columns: string[] }
  | { kind: 'sql'; title: string; subtitle: string; sql: string; engine: Engine }

interface Item {
  preview?: Preview
  themeId?: string
  group: string
  label: string
  detail?: string
  icon: string
  run: () => void
}

/** Lower score is better; -1 means no match (substring first, then subsequence). */
function score(text: string, q: string): number {
  if (!q) return 0
  const t = text.toLowerCase()
  const i = t.indexOf(q)
  if (i >= 0) return i === 0 || /[\s._]/.test(t[i - 1]) ? i : 50 + i
  let j = 0
  for (const ch of t) if (ch === q[j]) j++
  return j === q.length ? 200 + t.length : -1
}

const TITLES = { themes: 'Choose Theme', all: 'Search Everywhere', actions: 'Find Action', tables: 'Go to Table', tabs: 'Recent Tabs', consoles: 'Open Query Console' }

export function CommandPalette({ mode, connectionId }: { mode: keyof typeof TITLES; connectionId?: string }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const { tabs, recent, metadata, connections, consoles } = useApp()

  // make sure the current data source's tables are searchable
  useEffect(() => {
    const id = activeTab()?.connectionId ?? connections[0]?.id
    if (id && (mode === 'all' || mode === 'tables')) void ensureMetadata(id)
  }, [mode, connections])

  const items = useMemo(() => {
    const out: Item[] = []
    if (mode === 'themes') {
      out.push({ group: 'Themes', themeId: 'system', label: 'System (follow macOS appearance)', icon: 'sun', run: () => setPrefs({ theme: 'system' }) })
      for (const t of THEMES) out.push({ group: 'Themes', themeId: t.id, label: t.name, detail: t.dark ? 'dark' : 'light', icon: 'sun', run: () => setPrefs({ theme: t.id }) })
    }
    if (mode === 'consoles' && connectionId) {
      // "New console" stays pinned on top while the list is unfiltered
      out.push({ group: 'Consoles', label: '+ New Query Console', detail: connectionById(connectionId)?.name, icon: 'plus', run: () => openConsole(connectionId) })
      for (const c of consolesOf(connectionId, consoles)) {
        const open = tabs.some((t) => t.kind === 'console' && t.consoleId === c.id)
        out.push({ group: 'Consoles', label: c.name, detail: `${open ? 'open · ' : ''}${c.text.trim().split('\n')[0]?.slice(0, 50) ?? ''}`, icon: 'console', run: () => void openSavedConsole(c.id) })
      }
    }
    if (mode === 'all') {
      for (const c of consoles) {
        const conn = connectionById(c.connectionId)
        out.push({
          group: 'Consoles',
          label: c.name,
          detail: conn?.name,
          icon: 'console',
          run: () => void openSavedConsole(c.id),
          preview: conn && { kind: 'sql', title: c.name, subtitle: `${conn.name} · console`, sql: c.text.trim().slice(0, PREVIEW_SQL_CHARS) || '-- empty', engine: conn.engine }
        })
      }
    }
    if (mode === 'all' || mode === 'tabs') {
      const ordered = [...recent.map((id) => tabs.find((t) => t.id === id)).filter((t) => !!t), ...tabs.filter((t) => !recent.includes(t.id))]
      for (const t of ordered) out.push({ group: 'Tabs', label: t.title, detail: connectionById(t.connectionId)?.name, icon: t.kind === 'table' ? 'table' : t.kind === 'ddl' ? 'ddl' : 'console', run: () => activate(t.id) })
    }
    if (mode === 'all' || mode === 'tables') {
      for (const [connId, raw] of Object.entries(metadata)) {
        if (!raw) continue
        const conn = connectionById(connId)
        const md = visibleMetadata(raw, conn?.hiddenSchemas)
        for (const t of md.tables) {
          const open = () => openTable(connId, t.schema, t.name)
          out.push({
            group: 'Tables',
            label: t.schema === md.defaultSchema ? t.name : `${t.schema}.${t.name}`,
            detail: conn?.name,
            icon: t.kind,
            run: open,
            preview: {
              kind: 'table',
              title: t.name,
              subtitle: `${conn?.environment ? `${environmentLabel(conn.environment)} · ` : ''}${t.schema}.${t.name} · ${t.kind}`,
              columns: t.columns
            }
          })
        }
      }
    }
    if (mode === 'all' || mode === 'actions') {
      for (const a of ACTIONS) if (hasHandler(a.id)) out.push({ group: 'Actions', label: a.title, detail: keyLabel(a.id), icon: 'search', run: () => dispatch(a.id) })
    }
    const needle = q.trim().toLowerCase()
    return out
      .map((it) => ({ it, s: score(it.label, needle) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => (needle ? a.s - b.s : 0))
      .slice(0, 200)
      .map((x) => x.it)
  }, [mode, q, tabs, recent, metadata, connections, consoles, connectionId])

  useEffect(() => {
    setSel(0)
  }, [q])
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  // live preview: the whole app takes the highlighted theme; closing without choosing restores it
  useEffect(() => {
    if (mode !== 'themes') return
    const id = items[sel]?.themeId
    useApp.setState({ themePreview: id === 'system' ? undefined : id })
  }, [mode, sel, items])
  useEffect(() => () => useApp.setState({ themePreview: undefined }), [])

  const preview = items[sel]?.preview
  const choose = (it: Item | undefined) => {
    if (!it) return
    closeModal()
    it.run()
  }

  return (
    <Modal onClose={closeModal} className={`palette${mode === 'all' || mode === 'tables' ? ' with-preview' : ''}`}>
      <input
        className="input"
        autoFocus
        placeholder={TITLES[mode] + '…'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
          else if (e.key === 'Enter') (e.preventDefault(), choose(items[sel]))
        }}
      />
      <div className="palette-body">
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="palette-item muted">Nothing found</div>}
          {items.map((it, i) => (
            <div key={i}>
              {(i === 0 || items[i - 1].group !== it.group) && mode === 'all' && <div className="palette-group">{it.group}</div>}
              <div className={`palette-item${i === sel ? ' on' : ''}`} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => choose(it)}>
                {it.themeId && themeById(it.themeId) ? <ThemeSwatch theme={themeById(it.themeId)!} size="row" /> : <Icon name={it.icon} />}
                <span className="grow">{it.label}</span>
                {it.detail && <span className="muted small">{it.detail}</span>}
              </div>
            </div>
          ))}
        </div>
        {(mode === 'all' || mode === 'tables') && (
          <aside className="palette-preview" aria-label="Preview">
            {preview ? <PreviewPane p={preview} /> : <span className="muted small">Highlight a table or console to preview it.</span>}
          </aside>
        )}
      </div>
    </Modal>
  )
}

const PREVIEW_SQL_CHARS = 1200
const PREVIEW_COLUMNS = 14

function PreviewPane({ p }: { p: Preview }) {
  return (
    <>
      <div className="pp-head">
        <b>{p.title}</b>
        <span className="mono muted">{p.subtitle}</span>
      </div>
      {p.kind === 'sql' ? (
        <SqlPreview sql={p.sql} engine={p.engine} />
      ) : (
        <>
          <div className="pp-columns mono">
            {p.columns.slice(0, PREVIEW_COLUMNS).map((c) => (
              <span key={c}>{c}</span>
            ))}
            {p.columns.length > PREVIEW_COLUMNS && <span className="muted">+{p.columns.length - PREVIEW_COLUMNS} more</span>}
          </div>
          <div className="pp-keys">
            <span>Open data</span>
            <kbd className="key">↩</kbd>
          </div>
        </>
      )}
    </>
  )
}
