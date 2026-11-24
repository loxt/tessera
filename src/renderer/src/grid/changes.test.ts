import { describe, expect, test } from 'vitest'
import type { ColumnMeta, TableInfo } from '@shared/model'
import { addRow, cellState, deleteRows, displayValue, editCell, EMPTY, isEmpty, revertAll, toChangeSet } from './changes'

const columns: ColumnMeta[] = [
  { name: 'id', type: 'int4' },
  { name: 'name', type: 'text' }
]
const rows = [
  [1, 'Ann'],
  [2, 'Bob']
]
const info: TableInfo = {
  schema: 'public',
  name: 'people',
  kind: 'table',
  columns: [],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: []
}

describe('pending grid changes', () => {
  test('editing a server row records an update keyed by the original PK', () => {
    const p = editCell(EMPTY, rows, 0, 1, 'Anna')
    expect(cellState(p, rows.length, 0, 1)).toBe('edited')
    expect(displayValue(p, rows, 0, 1)).toBe('Anna')
    expect(toChangeSet(p, info, columns, rows).updates).toEqual([{ key: [1], set: { name: 'Anna' } }])
  })

  test('editing back to the original value removes the edit', () => {
    const p = editCell(editCell(EMPTY, rows, 0, 1, 'Anna'), rows, 0, 1, 'Ann')
    expect(isEmpty(p)).toBe(true)
  })

  test('editing the PK updates by the old key', () => {
    const p = editCell(EMPTY, rows, 1, 0, '20')
    expect(toChangeSet(p, info, columns, rows).updates).toEqual([{ key: [2], set: { id: '20' } }])
  })

  test('inserted rows live after server rows and only send set cells', () => {
    let p = addRow(EMPTY)
    p = editCell(p, rows, 2, 1, 'Cy')
    expect(cellState(p, rows.length, 2, 1)).toBe('inserted')
    expect(displayValue(p, rows, 2, 0)).toBeUndefined() // DEFAULT
    expect(toChangeSet(p, info, columns, rows).inserts).toEqual([{ name: 'Cy' }])
  })

  test('deleting server rows marks them; deleting inserted rows drops them; edits on deleted rows are not sent', () => {
    let p = editCell(addRow(EMPTY), rows, 0, 1, 'X')
    p = deleteRows(p, [0, 2], rows.length)
    expect(cellState(p, rows.length, 0, 0)).toBe('deleted')
    expect(p.inserted).toEqual([])
    const cs = toChangeSet(p, info, columns, rows)
    expect(cs.deletes).toEqual([[1]])
    expect(cs.updates).toEqual([])
  })

  test('SQLite rowid tables key by the rowid column', () => {
    const cols: ColumnMeta[] = [{ name: 'rowid', type: '' }, ...columns]
    const r = [[10, 1, 'Ann']]
    const p = deleteRows(EMPTY, [0], 1)
    expect(toChangeSet(p, { ...info, primaryKey: [], rowid: true }, cols, r)).toMatchObject({ keyColumns: ['rowid'], deletes: [[10]] })
  })

  test('revertAll clears everything', () => {
    expect(isEmpty(revertAll())).toBe(true)
  })
})
