import { useEffect, useMemo, useState } from 'react'
import { ACTIONS } from '@shared/actions'
import { accelLabel, eventToAccel, findConflicts, SCOPES, type Bindings, type Scope } from '@shared/keymap'
import { applyKeymap, importKeymapFromDataGrip, IS_MAC, useApp } from '../store'

/** While true, dialogs must not treat Escape as "close" — the recorder owns the keyboard. */
export const recorder = { active: false }

const GROUPS: { scope: Scope; title: string }[] = [
  { scope: 'global', title: 'Global' },
  { scope: 'editor', title: 'SQL Editor' },
  { scope: 'grid', title: 'Data Grid' }
]

const titleOf = (id: string) => ACTIONS.find((a) => a.id === id)?.title ?? id

export function KeymapPanel() {
  const { bindings, keymap } = useApp()
  const [q, setQ] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ id: string; accel: string; others: string[] } | null>(null)

  const save = (next: Bindings) => applyKeymap({ source: keymap?.source ?? 'Tessera defaults', bindings: next })

  const assign = (id: string, accel: string, steal: string[]) => {
    const next: Bindings = { ...bindings }
    for (const other of steal) next[other] = (next[other] ?? []).filter((a) => a !== accel)
    next[id] = [...new Set([...(next[id] ?? []), accel])]
    save(next)
    setConflict(null)
  }

  useEffect(() => {
    recorder.active = recording !== null
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return setRecording(null)
      const accel = eventToAccel(e)
      if (!accel) return // modifier alone: keep listening
      const others = findConflicts(bindings, SCOPES, recording, accel)
      if (others.length) setConflict({ id: recording, accel, others })
      else assign(recording, accel, [])
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      recorder.active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, bindings])

  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      ACTIONS.filter(
        (a) =>
          !needle ||
          a.title.toLowerCase().includes(needle) ||
          a.id.includes(needle) ||
          (bindings[a.id] ?? []).some((k) => accelLabel(k, IS_MAC).toLowerCase().includes(needle) || k.toLowerCase().includes(needle))
      ),
    [needle, bindings]
  )

  return (
    <div className="keymap">
      <div className="keymap-head">
        <span className="muted small grow">
          Source: <b>{keymap?.source ?? 'Tessera defaults'}</b>
        </span>
        <button className="btn outline" onClick={() => void importKeymapFromDataGrip()}>Import from DataGrip</button>
        <button className="btn outline" onClick={() => applyKeymap({ source: 'Tessera defaults', bindings: {} })}>Reset to defaults</button>
      </div>
      <input className="input" placeholder="Search actions or shortcuts (e.g. “format” or “⌘D”)…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="keymap-list">
        {GROUPS.map((g) => {
          const items = rows.filter((a) => (a.scope ?? 'global') === g.scope)
          if (!items.length) return null
          return (
            <div key={g.scope}>
              <div className="palette-group">{g.title}</div>
              {items.map((a) => (
                <div key={a.id}>
                  <div className="keymap-row">
                    <span className="grow">{a.title}</span>
                    {a.id === 'search.everywhere' ? (
                      <span className="kchip">⇧⇧</span>
                    ) : (
                      <>
                        {(bindings[a.id] ?? []).map((k) => (
                          <span key={k} className="kchip" title={k}>
                            {accelLabel(k, IS_MAC)}
                            <button aria-label={`Remove ${accelLabel(k, IS_MAC)}`} onClick={() => save({ ...bindings, [a.id]: (bindings[a.id] ?? []).filter((x) => x !== k) })}>
                              ×
                            </button>
                          </span>
                        ))}
                        {recording === a.id ? (
                          <span className="kchip recording">Press keys… (Esc cancels)</span>
                        ) : (
                          <button className="btn outline small" onClick={() => (setConflict(null), setRecording(a.id))} title="Add a shortcut">
                            +
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {conflict?.id === a.id && (
                    <div className="keymap-conflict">
                      {accelLabel(conflict.accel, IS_MAC)} is already used by {conflict.others.map(titleOf).join(', ')}.
                      <button className="btn outline small" onClick={() => assign(conflict.id, conflict.accel, conflict.others)}>Reassign</button>
                      <button className="btn small" onClick={() => setConflict(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="muted small">Shortcuts in “SQL Editor” and “Data Grid” apply only while that area has focus, like DataGrip. Two-keystroke shortcuts are not supported.</div>
    </div>
  )
}
