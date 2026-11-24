import { describe, expect, it } from 'vitest'
import { sanitizeViews, viewsFor, type SavedView } from './views'

const v = (over: Partial<SavedView> = {}): SavedView => ({
  id: 'v1',
  connectionId: 'c1',
  schema: 'public',
  table: 'orders',
  name: 'Pending orders',
  conditions: [{ column: 'status', op: 'eq', value: 'new' }],
  base: '',
  orderBy: 'created_at DESC',
  ...over
})

describe('sanitizeViews', () => {
  it('keeps well-formed views', () => {
    expect(sanitizeViews([v()])).toEqual([v()])
  })
  it('drops views with missing fields or unknown operators, and bad conditions', () => {
    const out = sanitizeViews([
      v({ id: 'ok' }),
      { ...v({ id: 'no-name' }), name: '' },
      v({ id: 'bad-op', conditions: [{ column: 'a', op: 'drop table' as never }] }),
      { id: 'x' },
      'nonsense'
    ])
    expect(out.map((x) => x.id)).toEqual(['ok'])
  })
  it('caps the list', () => {
    expect(sanitizeViews(Array.from({ length: 3000 }, (_, i) => v({ id: `v${i}` }))).length).toBe(2000)
  })
})

describe('viewsFor', () => {
  it('lists a table’s views by name', () => {
    const list = [v({ id: 'b', name: 'Zeta' }), v({ id: 'a', name: 'Alpha' }), v({ id: 'c', table: 'customers' })]
    expect(viewsFor(list, 'c1', 'public', 'orders').map((x) => x.name)).toEqual(['Alpha', 'Zeta'])
  })
})
