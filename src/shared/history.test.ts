import { describe, expect, it } from 'vitest'
import { formatDuration, groupByDay, mergeHistory, searchHistory, SLOW_MS } from './history'
import type { HistoryEntry } from './model'

const at = (iso: string) => new Date(iso).getTime()
const h = (sql: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ connectionId: 'a', sql, at: at('2026-10-21T10:00:00'), durationMs: 5, ok: true, ...over })

describe('searchHistory', () => {
  const list = [
    h('select * from orders where status = 1'),
    h('select * from customers', { ok: false, error: 'relation does not exist' }),
    h('update orders set status = 2', { durationMs: SLOW_MS + 1 })
  ]

  it('matches every word, in any order, ignoring case', () => {
    expect(searchHistory(list, 'ORDERS status', 'all').map((e) => e.sql)).toEqual([list[0].sql, list[2].sql])
    expect(searchHistory(list, 'status select', 'all')).toEqual([list[0]])
  })

  it('returns everything for an empty search', () => {
    expect(searchHistory(list, '  ', 'all')).toHaveLength(3)
  })

  it('also searches the error message of failed queries', () => {
    expect(searchHistory(list, 'not exist', 'all')).toEqual([list[1]])
  })

  it('filters failed and slow queries', () => {
    expect(searchHistory(list, '', 'failed')).toEqual([list[1]])
    expect(searchHistory(list, '', 'slow')).toEqual([list[2]])
  })
})

describe('groupByDay', () => {
  it('labels today and yesterday, then dates', () => {
    const now = new Date('2026-10-21T15:00:00')
    const groups = groupByDay(
      [h('a', { at: at('2026-10-21T09:00:00') }), h('b', { at: at('2026-10-20T23:00:00') }), h('c', { at: at('2026-10-14T08:00:00') }), h('d', { at: at('2026-10-14T07:00:00') })],
      now
    )
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.sql)])).toEqual([
      ['Today', ['a']],
      ['Yesterday', ['b']],
      ['Wed, Oct 14', ['c', 'd']]
    ])
  })
})

describe('mergeHistory', () => {
  it('flattens every data source, newest first', () => {
    const merged = mergeHistory({ a: [h('x', { at: 3 }), h('y', { at: 1 })], b: [h('z', { connectionId: 'b', at: 2 })] })
    expect(merged.map((e) => e.sql)).toEqual(['x', 'z', 'y'])
  })
})

describe('formatDuration', () => {
  it('picks a readable unit', () => {
    expect(formatDuration(38)).toBe('38 ms')
    expect(formatDuration(1250)).toBe('1.3 s')
    expect(formatDuration(125_000)).toBe('2 min 5 s')
  })
})
