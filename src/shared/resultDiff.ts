// Compare two query results (before / after a change), row by row. Rows match by key columns (an id
// column by default); without a key, whole rows match and a changed row reads as removed + added.
// Columns are aligned by name, so a different column order still compares.
import { cellText } from './export'
import type { CellValue, ResultSet } from './model'

export type RowStatus = 'added' | 'removed' | 'changed' | 'same'

export interface DiffRow {
  status: RowStatus
  /** in the baseline's column order: the new values, or the old ones for removed rows */
  values: CellValue[]
  /** changed rows: the old values */
  before?: CellValue[]
  /** changed rows: indexes of the cells that differ */
  changed?: number[]
}

export interface ResultDiff {
  rows: DiffRow[]
  counts: Record<RowStatus, number>
}

export const defaultKey = (r: ResultSet): number[] => {
  const i = r.columns.findIndex((c) => c.name.toLowerCase() === 'id')
  return i >= 0 ? [i] : []
}

const cellKey = (v: CellValue) => (v === null ? '\u0000' : `${typeof v === 'object' ? 'b' : typeof v}:${cellText(v)}`)
const same = (a: CellValue, b: CellValue) => cellKey(a) === cellKey(b)

/** `key` indexes refer to the baseline's columns. */
export function diffResults(base: ResultSet, other: ResultSet, key: number[]): ResultDiff {
  const names = base.columns.map((c) => c.name)
  const map = names.map((n) => other.columns.findIndex((c) => c.name === n))
  if (map.some((i) => i < 0) || other.columns.length !== names.length) throw new Error('Both results need the same columns to compare')
  const aligned = other.rows.map((row) => map.map((i) => row[i]))
  const cols = key.length ? key : names.map((_, i) => i)
  const keyOf = (row: CellValue[]) => cols.map((i) => cellKey(row[i])).join('\u0001')

  // a queue per key, so duplicate rows pair up one to one
  const pending = new Map<string, CellValue[][]>()
  for (const row of base.rows) pending.set(keyOf(row), [...(pending.get(keyOf(row)) ?? []), row])

  const rows: DiffRow[] = []
  for (const row of aligned) {
    const queue = pending.get(keyOf(row))
    const old = queue?.shift()
    if (!old) {
      rows.push({ status: 'added', values: row })
      continue
    }
    const changed = row.map((v, i) => (same(v, old[i]) ? -1 : i)).filter((i) => i >= 0)
    rows.push(changed.length ? { status: 'changed', values: row, before: old, changed } : { status: 'same', values: row })
  }
  for (const queue of pending.values()) for (const row of queue) rows.push({ status: 'removed', values: row })

  const counts: Record<RowStatus, number> = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const r of rows) counts[r.status]++
  return { rows, counts }
}
