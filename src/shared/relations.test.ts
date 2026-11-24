import { describe, expect, it } from 'vitest'
import type { CompletionMetadata } from './model'
import { neighborhood } from './relations'

const md: CompletionMetadata = {
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    { schema: 'public', name: 'customers', kind: 'table', columns: ['id', 'name'] },
    { schema: 'public', name: 'orders', kind: 'table', columns: ['id', 'customer_id', 'status'] },
    { schema: 'public', name: 'order_items', kind: 'table', columns: ['order_id', 'product_id', 'qty'] },
    { schema: 'public', name: 'products', kind: 'table', columns: ['id', 'title'] },
    { schema: 'public', name: 'employees', kind: 'table', columns: ['id', 'manager_id'] }
  ],
  foreignKeys: [
    { schema: 'public', table: 'orders', columns: ['customer_id'], refSchema: 'public', refTable: 'customers', refColumns: ['id'] },
    { schema: 'public', table: 'order_items', columns: ['order_id'], refSchema: 'public', refTable: 'orders', refColumns: ['id'] },
    { schema: 'public', table: 'order_items', columns: ['product_id'], refSchema: 'public', refTable: 'products', refColumns: ['id'] },
    { schema: 'public', table: 'employees', columns: ['manager_id'], refSchema: 'public', refTable: 'employees', refColumns: ['id'] }
  ]
}

describe('neighborhood', () => {
  it('puts referenced tables on the left and referencing tables on the right', () => {
    const n = neighborhood(md, 'public', 'orders')!
    expect(n.focus.name).toBe('orders')
    expect(n.parents.map((t) => t.name)).toEqual(['customers'])
    expect(n.children.map((t) => t.name)).toEqual(['order_items'])
    expect(n.edges).toEqual([
      { from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' } },
      { from: { table: 'order_items', column: 'order_id' }, to: { table: 'orders', column: 'id' } }
    ])
  })

  it('shows a self reference once, on the focus table', () => {
    const n = neighborhood(md, 'public', 'employees')!
    expect(n.parents).toEqual([])
    expect(n.children).toEqual([])
    expect(n.edges).toEqual([{ from: { table: 'employees', column: 'manager_id' }, to: { table: 'employees', column: 'id' } }])
  })

  it('is null for an unknown table', () => {
    expect(neighborhood(md, 'public', 'nope')).toBeNull()
  })

  it('lists a table that is both parent and child once, as a parent', () => {
    const loop: CompletionMetadata = {
      ...md,
      foreignKeys: [...md.foreignKeys!, { schema: 'public', table: 'customers', columns: ['name'], refSchema: 'public', refTable: 'orders', refColumns: ['status'] }]
    }
    const n = neighborhood(loop, 'public', 'orders')!
    expect(n.parents.map((t) => t.name)).toEqual(['customers'])
    expect(n.children.map((t) => t.name)).toEqual(['order_items'])
  })
})
