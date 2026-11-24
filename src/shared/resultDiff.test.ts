import { describe, expect, it } from 'vitest'
import type { ResultSet } from './model'
import { defaultKey, diffResults } from './resultDiff'

const rs = (columns: string[], rows: (string | number | null)[][]): ResultSet => ({ columns: columns.map((name) => ({ name, type: 'text' })), rows, hasMore: false })

describe('defaultKey', () => {
  it('prefers an id column, else the whole row', () => {
    expect(defaultKey(rs(['name', 'ID'], []))).toEqual([1])
    expect(defaultKey(rs(['a', 'b'], []))).toEqual([])
  })
})

describe('diffResults', () => {
  const before = rs(['id', 'status', 'total'], [
    [1, 'new', 10],
    [2, 'paid', 20],
    [3, 'new', 30]
  ])
  const after = rs(['id', 'total', 'status'], [
    [1, 10, 'new'],
    [2, 25, 'shipped'],
    [4, 40, 'new']
  ])

  it('matches rows by key and finds added, removed and changed cells, aligning columns by name', () => {
    const d = diffResults(before, after, [0])
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 1, same: 1 })
    const changed = d.rows.find((r) => r.status === 'changed')!
    expect(changed.values).toEqual([2, 'shipped', 25])
    expect(changed.before).toEqual([2, 'paid', 20])
    expect(changed.changed).toEqual([1, 2])
    expect(d.rows.find((r) => r.status === 'added')?.values).toEqual([4, 'new', 40])
    expect(d.rows.find((r) => r.status === 'removed')?.values).toEqual([3, 'new', 30])
  })

  it('without a key, compares whole rows (a change shows as removed + added)', () => {
    const d = diffResults(before, after, [])
    expect(d.counts).toEqual({ added: 2, removed: 2, changed: 0, same: 1 })
  })

  it('counts duplicates: two equal rows before, one after, is one removal', () => {
    const d = diffResults(rs(['a'], [['x'], ['x']]), rs(['a'], [['x']]), [])
    expect(d.counts).toEqual({ added: 0, removed: 1, changed: 0, same: 1 })
  })

  it('refuses results with different columns', () => {
    expect(() => diffResults(before, rs(['id', 'other'], []), [0])).toThrow(/same columns/)
  })
})
