import { useMemo } from 'react'
import { summarize } from '@shared/aggregate'
import type { CellValue } from '@shared/model'
import type { CellPos } from './DataGrid'

/** past this many cells the summary would cost more than it tells */
const MAX_CELLS = 200_000

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 })

/** Count, sum, average, min and max of the selected cells, like a spreadsheet's status bar. */
export function SelectionSummary({ cells, getValue }: { cells: CellPos[]; getValue: (r: number, c: number) => CellValue | undefined }) {
  const summary = useMemo(() => {
    if (cells.length < 2 || cells.length > MAX_CELLS) return null
    return summarize(cells.map((p) => getValue(p.r, p.c) ?? null))
  }, [cells, getValue])
  if (!summary) return null
  const n = summary.numeric
  return (
    <span className="sel-summary" aria-live="polite">
      <span>
        <b>Count</b> {fmt(summary.count)}
      </span>
      {n ? (
        <>
          <span>
            <b>Sum</b> {fmt(n.sum)}
          </span>
          <span>
            <b>Avg</b> {fmt(n.avg)}
          </span>
          <span>
            <b>Min</b> {fmt(n.min)}
          </span>
          <span>
            <b>Max</b> {fmt(n.max)}
          </span>
        </>
      ) : (
        <span>
          <b>Distinct</b> {fmt(summary.distinct)}
        </span>
      )}
      {summary.nulls > 0 && (
        <span>
          <b>NULL</b> {fmt(summary.nulls)}
        </span>
      )}
    </span>
  )
}
