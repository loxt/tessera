import { useMemo, useState } from 'react'
import { cellText } from '@shared/export'
import type { CellValue } from '@shared/model'
import { defaultKey, diffResults, type RowStatus } from '@shared/resultDiff'
import { errorMessage } from '../api'
import { DataGrid, type CellState } from '../grid/DataGrid'
import type { ResultTab } from './ResultsPanel'

const STATE: Record<RowStatus, CellState> = { added: 'inserted', removed: 'deleted', changed: undefined, same: undefined }

/** Pinned result (before) against a newer one (after): rows matched by a key, differences colored like edits. */
export function CompareView({ base, other }: { base: ResultTab; other: ResultTab }) {
  const [key, setKey] = useState<number[]>(() => defaultKey(base.result))
  const [onlyDiff, setOnlyDiff] = useState(true)
  const diff = useMemo(() => {
    try {
      return { ok: true as const, value: diffResults(base.result, other.result, key) }
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) }
    }
  }, [base, other, key])

  const rows = useMemo(() => (diff.ok ? diff.value.rows.filter((r) => !onlyDiff || r.status !== 'same') : []), [diff, onlyDiff])
  const getValue = (r: number, c: number): CellValue | undefined => {
    const row = rows[r]
    if (!row) return undefined
    // a changed cell shows the new value and what it was
    return row.status === 'changed' && row.changed?.includes(c) ? `${cellText(row.values[c])}  ← was ${row.before![c] === null ? 'NULL' : cellText(row.before![c])}` : row.values[c]
  }
  const getState = (r: number, c: number): CellState => {
    const row = rows[r]
    if (!row) return undefined
    return row.status === 'changed' ? (row.changed?.includes(c) ? 'edited' : undefined) : STATE[row.status]
  }

  if (!diff.ok) return <div className="empty">{diff.error}</div>
  const n = diff.value.counts
  return (
    <>
      <div className="compare-bar">
        <span className="muted small">
          <b>{base.title}</b> → <b>{other.title}</b>
        </span>
        <span className="diff-counts" style={{ marginLeft: 0 }}>
          <span className="add">+{n.added}</span>
          <span className="chg">~{n.changed}</span>
          <span className="del">−{n.removed}</span>
          <span className="same">={n.same}</span>
        </span>
        <span className="grow" />
        <label className="muted small" htmlFor="compare-key">Match rows by</label>
        <select id="compare-key" className="input" value={key.length ? String(key[0]) : ''} onChange={(e) => setKey(e.target.value === '' ? [] : [Number(e.target.value)])}>
          <option value="">the whole row</option>
          {base.result.columns.map((c, i) => (
            <option key={c.name} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="compare-toggle">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only differences
        </label>
      </div>
      {rows.length ? (
        <DataGrid columns={base.result.columns} rowCount={rows.length} getValue={getValue} getState={getState} resetKey={`${base.id}|${other.id}|${key.join()}|${onlyDiff}`} />
      ) : (
        <div className="empty">The two results have the same rows.</div>
      )}
    </>
  )
}
