import type { ChangeSet } from '@shared/dml'
import type { CellValue, ColumnMeta, TableInfo } from '@shared/model'

/**
 * Pending edits of a table editor. Row indexes < server row count address fetched rows;
 * larger indexes address `inserted` rows (appended at the bottom, like DataGrip).
 * Inserted cells that were never set are `undefined` → column DEFAULT.
 */
export interface PendingChanges {
  edits: Record<number, Record<number, CellValue>>
  inserted: Record<number, CellValue>[]
  deleted: number[]
}

export const EMPTY: PendingChanges = { edits: {}, inserted: [], deleted: [] }

const same = (a: CellValue, b: CellValue) =>
  a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && a.hex === b.hex && a.size === b.size)

export function editCell(p: PendingChanges, rows: CellValue[][], r: number, c: number, value: CellValue): PendingChanges {
  if (r >= rows.length) {
    const i = r - rows.length
    return { ...p, inserted: p.inserted.map((row, k) => (k === i ? { ...row, [c]: value } : row)) }
  }
  const rowEdits = { ...p.edits[r] }
  if (same(rows[r][c], value)) delete rowEdits[c]
  else rowEdits[c] = value
  const edits = { ...p.edits }
  if (Object.keys(rowEdits).length) edits[r] = rowEdits
  else delete edits[r]
  return { ...p, edits }
}

export const addRow = (p: PendingChanges, init: Record<number, CellValue> = {}): PendingChanges => ({
  ...p,
  inserted: [...p.inserted, init]
})

export function deleteRows(p: PendingChanges, rowIdx: number[], serverCount: number): PendingChanges {
  const insertedGone = new Set(rowIdx.filter((r) => r >= serverCount).map((r) => r - serverCount))
  const server = rowIdx.filter((r) => r < serverCount)
  return {
    ...p,
    inserted: p.inserted.filter((_, i) => !insertedGone.has(i)),
    deleted: [...new Set([...p.deleted, ...server])].sort((a, b) => a - b)
  }
}

export function revertRows(p: PendingChanges, rowIdx: number[], serverCount: number): PendingChanges {
  const gone = new Set(rowIdx)
  const edits = Object.fromEntries(Object.entries(p.edits).filter(([r]) => !gone.has(Number(r))))
  return {
    edits,
    deleted: p.deleted.filter((r) => !gone.has(r)),
    inserted: p.inserted.filter((_, i) => !gone.has(i + serverCount))
  }
}

export const revertAll = (): PendingChanges => EMPTY

export const isEmpty = (p: PendingChanges) => !Object.keys(p.edits).length && !p.inserted.length && !p.deleted.length

export const changeCount = (p: PendingChanges) =>
  Object.values(p.edits).reduce((n, e) => n + Object.keys(e).length, 0) + p.inserted.length + p.deleted.length

/** Value to show; `undefined` means DEFAULT on an inserted row. */
export function displayValue(p: PendingChanges, rows: CellValue[][], r: number, c: number): CellValue | undefined {
  if (r >= rows.length) return p.inserted[r - rows.length]?.[c]
  const e = p.edits[r]
  return e && c in e ? e[c] : rows[r][c]
}

export function cellState(p: PendingChanges, serverCount: number, r: number, c: number): 'inserted' | 'deleted' | 'edited' | undefined {
  if (r >= serverCount) return 'inserted'
  if (p.deleted.includes(r)) return 'deleted'
  return p.edits[r] && c in p.edits[r] ? 'edited' : undefined
}

export function toChangeSet(p: PendingChanges, info: TableInfo, columns: ColumnMeta[], rows: CellValue[][]): ChangeSet {
  const keyColumns = info.primaryKey.length ? info.primaryKey : info.rowid ? ['rowid'] : []
  const keyIdx = keyColumns.map((k) => {
    const i = columns.findIndex((c) => c.name === k)
    if (i < 0) throw new Error(`Key column ${k} is not part of the result`)
    return i
  })
  const keyOf = (r: number) => keyIdx.map((i) => rows[r][i])
  const named = (e: Record<number, CellValue>) =>
    Object.fromEntries(
      Object.entries(e)
        .filter(([c]) => !(info.rowid && columns[Number(c)].name === 'rowid'))
        .map(([c, v]) => [columns[Number(c)].name, v])
    )
  return {
    schema: info.schema,
    table: info.name,
    keyColumns,
    updates: Object.entries(p.edits)
      .filter(([r]) => !p.deleted.includes(Number(r)))
      .map(([r, e]) => ({ key: keyOf(Number(r)), set: named(e) })),
    deletes: p.deleted.map(keyOf),
    inserts: p.inserted.map(named)
  }
}
