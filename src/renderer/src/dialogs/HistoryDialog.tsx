import { useEffect, useMemo, useRef, useState } from 'react'
import { connectionAccent } from '@shared/environment'
import { formatDuration, groupByDay, searchHistory, SLOW_MS, type HistoryStatus } from '@shared/history'
import type { HistoryEntry } from '@shared/model'
import { api, errorMessage } from '../api'
import { closeModal, notify, useApp, type Modal as ModalState } from '../store'
import { Modal } from './Dialogs'

type Scope = 'source' | 'all'
const STATUS_LABEL: Record<HistoryStatus, string> = { all: 'All', failed: 'Failed', slow: `Slow (≥ ${SLOW_MS / 1000} s)` }
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Query history: search by words, narrow to failed or slow runs, pick with the keyboard. */
export function HistoryDialog({ m }: { m: Extract<ModalState, { kind: 'history' }> }) {
  const connections = useApp((s) => s.connections)
  const [scope, setScope] = useState<Scope>('source')
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<HistoryStatus>('all')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setItems(null)
    api
      .history(scope === 'all' ? null : m.connectionId)
      .then(setItems)
      .catch((err) => {
        setItems([])
        notify('error', `History could not be read: ${errorMessage(err)}`)
      })
  }, [scope, m.connectionId])

  const shown = useMemo(() => searchHistory(items ?? [], text, status), [items, text, status])
  const groups = useMemo(() => groupByDay(shown, new Date()), [shown])
  useEffect(() => {
    setActive(0)
  }, [text, status, scope])
  useEffect(() => {
    list.current?.querySelector('.hist-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (sql: string, run: boolean) => {
    closeModal()
    m.onPick(sql, run)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.min(Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)), shown.length - 1))
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault()
      pick(shown[active].sql, e.metaKey || e.ctrlKey)
    }
  }
  const clear = () =>
    void api
      .clearHistory(m.connectionId)
      .then(() => setItems([]))
      .catch((err) => notify('error', errorMessage(err)))

  let n = -1
  return (
    <Modal
      title="Query history"
      wide
      onClose={closeModal}
      footer={
        <>
          <span className="left muted small">↑↓ move · ↩ insert · ⌘↩ insert and run · double-click runs</span>
          {scope === 'source' && (
            <button className="btn outline danger" disabled={!items?.length} onClick={clear}>
              Clear this data source
            </button>
          )}
          <button className="btn primary" onClick={closeModal}>Close</button>
        </>
      }
    >
      <div className="dialog-body hist" onKeyDown={onKeyDown}>
        <div className="hist-bar">
          <input className="input" autoFocus placeholder="Search SQL or error text, e.g. orders status" aria-label="Search history" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="seg" role="radiogroup" aria-label="Which data sources">
            {(['source', 'all'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={scope === s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>
                {s === 'source' ? 'This data source' : 'All data sources'}
              </button>
            ))}
          </div>
        </div>
        <div className="seg compact" role="radiogroup" aria-label="Status">
          {(Object.keys(STATUS_LABEL) as HistoryStatus[]).map((s) => (
            <button key={s} role="radio" aria-checked={status === s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="hist-list" ref={list} role="listbox" aria-label="Queries">
          {items === null && <div className="muted hist-empty">Loading…</div>}
          {items !== null && shown.length === 0 && (
            <div className="muted hist-empty">{items.length ? 'No query matches. Try fewer words or another status.' : 'No queries yet. Everything you run in a console shows up here.'}</div>
          )}
          {groups.map((g) => (
            <section key={g.label} className="hist-group">
              <h3>{g.label}</h3>
              {g.entries.map((h) => {
                const i = ++n
                const conn = connections.find((c) => c.id === h.connectionId)
                return (
                  <div
                    key={`${h.connectionId}-${h.at}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`hist-item${i === active ? ' on' : ''}${h.ok ? '' : ' failed'}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(h.sql, false)}
                    onDoubleClick={() => pick(h.sql, true)}
                  >
                    <div className="meta">
                      <span>{time(h.at)}</span>
                      <span>{formatDuration(h.durationMs)}</span>
                      {h.rows !== undefined && <span>{h.rows.toLocaleString()} rows</span>}
                      {!h.ok && <span className="bad">failed</span>}
                      {scope === 'all' && conn && (
                        <span className="src">
                          <span className="dot" style={{ background: connectionAccent(conn) ?? 'var(--faint)' }} />
                          {conn.name}
                        </span>
                      )}
                    </div>
                    <pre className="sql mono">{h.sql}</pre>
                    {h.error && <div className="err">{h.error}</div>}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  )
}
