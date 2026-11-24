import { describe, expect, test } from 'vitest'
import { toCompletionFks, toCompletionTables } from './catalog'

describe('toCompletionTables', () => {
  test('lists every table even when the column rows were cut off before reaching it', () => {
    const tables = [
      { schema: 'public', name: 'orders', is_view: false },
      { schema: 'supplier', name: 'sku_supplier', is_view: 0 },
      { schema: 'supplier', name: 'active_skus', is_view: true }
    ]
    // the column query hit its cap inside public.orders
    const columns = [
      { schema: 'public', name: 'orders', col: 'id' },
      { schema: 'public', name: 'orders', col: 'status' }
    ]
    expect(toCompletionTables(tables, columns)).toEqual([
      { schema: 'public', name: 'orders', kind: 'table', columns: ['id', 'status'] },
      { schema: 'supplier', name: 'sku_supplier', kind: 'table', columns: [] },
      { schema: 'supplier', name: 'active_skus', kind: 'view', columns: [] }
    ])
  })

  test('keeps column order and ignores columns of tables not listed', () => {
    const tables = [{ schema: 's', name: 't', is_view: false }]
    const columns = [
      { schema: 's', name: 't', col: 'b' },
      { schema: 's', name: 'gone', col: 'x' },
      { schema: 's', name: 't', col: 'a' }
    ]
    expect(toCompletionTables(tables, columns)[0].columns).toEqual(['b', 'a'])
  })
})

describe('toCompletionFks', () => {
  test('groups one row per column pair into foreign keys, in key order', () => {
    const rows = [
      { id: '7', schema: 'public', name: 'order_items', ref_schema: 'public', ref_name: 'orders', col: 'order_id', ref_col: 'id', pos: 1 },
      { id: '9', schema: 'public', name: 'ship', ref_schema: 'public', ref_name: 'stock', col: 'sku', ref_col: 'sku', pos: 2 },
      { id: '9', schema: 'public', name: 'ship', ref_schema: 'public', ref_name: 'stock', col: 'wh', ref_col: 'warehouse', pos: 1 }
    ]
    expect(toCompletionFks(rows)).toEqual([
      { schema: 'public', table: 'order_items', columns: ['order_id'], refSchema: 'public', refTable: 'orders', refColumns: ['id'] },
      { schema: 'public', table: 'ship', columns: ['wh', 'sku'], refSchema: 'public', refTable: 'stock', refColumns: ['warehouse', 'sku'] }
    ])
  })

  test('drops keys whose referenced column is unknown', () => {
    expect(toCompletionFks([{ id: '1', schema: 'main', name: 'a', ref_schema: 'main', ref_name: 'b', col: 'b_id', ref_col: null, pos: 0 }])).toEqual([])
  })
})
