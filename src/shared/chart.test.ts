import { describe, expect, it } from 'vitest'
import { buildSeries, guessChart, niceTicks, numericColumns } from './chart'
import type { ResultSet } from './model'

const rs: ResultSet = {
  columns: [
    { name: 'month', type: 'text' },
    { name: 'revenue', type: 'numeric' },
    { name: 'orders', type: 'bigint' },
    { name: 'note', type: 'text' }
  ],
  rows: [
    ['2026-01', '1200.50', '10', 'a'],
    ['2026-02', '900', 8, null],
    ['2026-01', '100', '2', 'b'],
    ['2026-03', null, 5, 'c']
  ],
  hasMore: false
}

describe('niceTicks', () => {
  it('rounds to 1-2-5 steps that cover the range, starting at zero for positive data', () => {
    expect(niceTicks(0, 1300, 5)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(0, 7, 5)).toEqual([0, 2, 4, 6, 8])
  })
  it('handles negatives and a flat range', () => {
    expect(niceTicks(-30, 45, 4)).toEqual([-40, -20, 0, 20, 40, 60])
    expect(niceTicks(5, 5, 5)).toEqual([0, 1, 2, 3, 4, 5])
    expect(niceTicks(0, 0, 4)).toEqual([0, 0.5, 1])
  })
})

describe('numericColumns', () => {
  it('keeps columns whose non-NULL values are all numbers (exact numerics included)', () => {
    expect(numericColumns(rs)).toEqual([1, 2])
  })
})

describe('guessChart', () => {
  it('picks the first non-numeric column as X and the numeric ones as Y, at most three', () => {
    expect(guessChart(rs)).toEqual({ x: 0, ys: [1, 2], type: 'line' })
  })
  it('chooses bars for plain categories', () => {
    const cats: ResultSet = { ...rs, rows: [['north', 1, 2, null], ['south', 3, 4, null]] }
    expect(guessChart(cats).type).toBe('bar')
  })
})

describe('buildSeries', () => {
  it('sums repeated X values, keeps first-seen order, and skips NULLs', () => {
    const s = buildSeries(rs, 0, [1, 2])
    expect(s.labels).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(s.values).toEqual([
      [1300.5, 900, null],
      [12, 8, 5]
    ])
    expect(s.summed).toBe(true)
  })
})
