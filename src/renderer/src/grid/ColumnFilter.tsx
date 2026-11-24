import { useEffect, useMemo, useRef, useState } from 'react'
import { cellText } from '@shared/export'
import type { CellValue } from '@shared/model'
import { Icon } from '../components/Icon'

/** key a value is filtered by; NULL gets its own key so it is never confused with the text "NULL" */
export const filterKey = (v: CellValue | undefined): string => (v === null || v === undefined ? '\u0000null' : cellText(v))

/** the longest list worth scrolling; past it, search narrows it down */
const MAX_VALUES = 2000

interface Props {
  anchor: DOMRect
  column: string
  values: (CellValue | undefined)[]
  /** keys currently shown; null when the column is not filtered */
  selected: ReadonlySet<string> | null
  onApply: (selected: Set<string> | null) => void
  onClose: () => void
}

/** DataGrip-style value filter for one column: distinct values with counts, search, check the ones to keep. */
export function ColumnFilter({ anchor, column, values, selected, onApply, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const distinct = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; isNull: boolean }>()
    for (const v of values) {
      const k = filterKey(v)
      const hit = counts.get(k)
      if (hit) hit.count++
      else counts.set(k, { label: k === '\u0000null' ? 'NULL' : cellText(v ?? null) || '(empty)', count: 1, isNull: k === '\u0000null' })
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
  }, [values])
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected ?? distinct.map(([k]) => k)))
  const needle = search.toLowerCase()
  const shown = distinct.filter(([, d]) => !needle || d.label.toLowerCase().includes(needle)).slice(0, MAX_VALUES)

  useEffect(() => {
    const down = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const toggle = (k: string) => setChecked((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])))
  const setShown = (on: boolean) => setChecked((s) => (on ? new Set([...s, ...shown.map(([k]) => k)]) : new Set([...s].filter((k) => !shown.some(([x]) => x === k)))))
  const apply = () => onApply(checked.size === distinct.length ? null : checked)
  const width = 320
  return (
    <div
      ref={box}
      className="col-filter"
      role="dialog"
      aria-label={`Filter ${column}`}
      style={{ top: anchor.bottom + 6, left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)), width }}
    >
      <div className="cf-head">
        <b>{column}</b>
        <span className="muted small">{distinct.length.toLocaleString()} values in the loaded rows</span>
      </div>
      <label className="foot-filter">
        <Icon name="search" />
        <input autoFocus placeholder="Search values" aria-label="Search values" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      </label>
      <div className="cf-bulk">
        <button className="btn small" onClick={() => setShown(true)}>Select {needle ? 'shown' : 'all'}</button>
        <button className="btn small" onClick={() => setShown(false)}>Clear {needle ? 'shown' : 'all'}</button>
      </div>
      <div className="cf-list" role="listbox" aria-multiselectable="true">
        {shown.map(([k, d]) => (
          <label key={k} className="cf-item">
            <input type="checkbox" checked={checked.has(k)} onChange={() => toggle(k)} />
            <span className={`grow${d.isNull ? ' null-label' : ''}`}>{d.label}</span>
            <span className="count">{d.count.toLocaleString()}</span>
          </label>
        ))}
        {shown.length === 0 && <div className="muted small" style={{ padding: 10 }}>No value matches "{search}".</div>}
      </div>
      <div className="cf-foot">
        {selected && (
          <button className="btn small" onClick={() => onApply(null)}>
            Remove filter
          </button>
        )}
        <span className="grow" />
        <button className="btn small" onClick={onClose}>Cancel</button>
        <button className="btn primary small" disabled={checked.size === 0} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  )
}
