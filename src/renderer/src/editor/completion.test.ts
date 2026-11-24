import { describe, expect, test } from 'vitest'
import type { CompletionMetadata } from '@shared/model'
import { computeUsage, quoteIfNeeded, suggest, tableRefs, type Usage } from './completion'

const md: CompletionMetadata = {
  defaultSchema: 'public',
  schemas: ['public', 'analytics'],
  tables: [
    { schema: 'public', name: 'customers', kind: 'table', columns: ['id', 'name', 'email'] },
    { schema: 'public', name: 'orders', kind: 'table', columns: ['id', 'customer_id', 'status'] },
    { schema: 'analytics', name: 'daily', kind: 'view', columns: ['day', 'total'] }
  ]
}

const at = (sqlWithCaret: string) => {
  const offset = sqlWithCaret.indexOf('|')
  return suggest(sqlWithCaret.replace('|', ''), offset, md, 'postgres')
}
const labels = (sqlWithCaret: string) => at(sqlWithCaret).map((s) => s.label)

describe('tableRefs', () => {
  test('finds tables with aliases across FROM lists and JOINs', () => {
    expect(tableRefs('select * from customers c, analytics.daily as d join orders o on o.customer_id = c.id where 1=1')).toEqual([
      { table: 'customers', alias: 'c' },
      { schema: 'analytics', table: 'daily', alias: 'd' },
      { table: 'orders', alias: 'o' }
    ])
  })
  test('ignores tables mentioned in strings', () => {
    expect(tableRefs("select 'from nowhere' from orders")).toEqual([{ table: 'orders' }])
  })
})

describe('quoteIfNeeded', () => {
  test('escapes hostile names instead of letting them break out of the quotes', () => {
    expect(quoteIfNeeded('x` = 1 OR 1=1 -- ', 'mysql')).toBe('`x`` = 1 OR 1=1 -- `')
    expect(quoteIfNeeded('a" or 1=1 --', 'sqlite')).toBe('"a"" or 1=1 --"')
    expect(quoteIfNeeded('plain_name', 'mysql')).toBe('plain_name')
  })
})

describe('suggest', () => {
  test('after FROM suggests tables of the default schema and other schemas', () => {
    const l = labels('select * from |')
    expect(l).toContain('customers')
    expect(l).toContain('orders')
    expect(l).toContain('analytics')
    expect(l).not.toContain('id')
  })

  test('schema qualifier lists that schema’s tables', () => {
    expect(labels('select * from analytics.|')).toEqual(['daily'])
  })

  test('schema qualifier wins over a same-named table the statement does not reference', () => {
    const shadowed: CompletionMetadata = {
      defaultSchema: 'public',
      schemas: ['public', 'supplier'],
      tables: [
        { schema: 'public', name: 'supplier', kind: 'table', columns: ['id', 'name'] },
        { schema: 'supplier', name: 'sku_supplier', kind: 'table', columns: ['sku', 'supplier_id'] }
      ]
    }
    const suggestAt = (sql: string) => suggest(sql.replace('|', ''), sql.indexOf('|'), shadowed, 'postgres').map((s) => s.label)
    expect(suggestAt('select * from supplier.|')).toEqual(['sku_supplier'])
    expect(suggestAt('select * from supplier.sku|')).toEqual(['sku_supplier'])
    // referenced in the statement: the qualifier is the table, so its columns
    expect(suggestAt('select supplier.| from supplier')).toEqual(['id', 'name'])
  })

  test('alias qualifier resolves to the aliased table columns', () => {
    expect(labels('select o.| from orders o')).toEqual(['id', 'customer_id', 'status'])
  })

  test('table-name qualifier works without alias', () => {
    expect(labels('select customers.| from customers')).toEqual(['id', 'name', 'email'])
  })

  test('select list offers columns of referenced tables first, plus keywords', () => {
    const s = at('select | from customers c join orders o on true')
    const cols = s.filter((x) => x.kind === 'column').map((x) => x.label)
    expect(cols).toEqual(expect.arrayContaining(['name', 'email', 'customer_id', 'status']))
    expect(s.some((x) => x.kind === 'keyword' && x.label === 'WHERE')).toBe(true)
    expect(s[0].kind).toBe('column')
  })

  test('only looks at the statement under the caret', () => {
    const cols = at('select * from orders;\nselect | from customers').filter((x) => x.kind === 'column').map((x) => x.label)
    expect(cols).toEqual(['id', 'name', 'email'])
  })
})

const rel: CompletionMetadata = {
  defaultSchema: 'public',
  schemas: ['public'],
  tables: [
    { schema: 'public', name: 'customers', kind: 'table', columns: ['id', 'name', 'email'] },
    { schema: 'public', name: 'orders', kind: 'table', columns: ['id', 'customer_id', 'status'] },
    { schema: 'public', name: 'order_items', kind: 'table', columns: ['order_id', 'product_id', 'qty'] },
    { schema: 'public', name: 'products', kind: 'table', columns: ['id', 'title'] },
    { schema: 'public', name: 'fleet_orders', kind: 'table', columns: ['id'] }
  ],
  foreignKeys: [
    { schema: 'public', table: 'orders', columns: ['customer_id'], refSchema: 'public', refTable: 'customers', refColumns: ['id'] },
    { schema: 'public', table: 'order_items', columns: ['order_id'], refSchema: 'public', refTable: 'orders', refColumns: ['id'] },
    { schema: 'public', table: 'order_items', columns: ['product_id'], refSchema: 'public', refTable: 'products', refColumns: ['id'] }
  ]
}
const relAt = (sqlWithCaret: string, usage?: Usage) => {
  const offset = sqlWithCaret.indexOf('|')
  const items = suggest(sqlWithCaret.replace('|', ''), offset, rel, 'postgres', usage)
  // Monaco orders matching items by sortText
  return [...items].sort((a, b) => a.sortText.localeCompare(b.sortText))
}

describe('keyword position', () => {
  test('after a complete select list only keywords are offered, FROM first', () => {
    const s = relAt('select * fr|')
    expect(s.every((x) => x.kind === 'keyword')).toBe(true)
    expect(s[0].label).toBe('FROM')
    expect(s.map((x) => x.label)).not.toContain('DELETE FROM')
  })

  test('keywords are inserted in the case being typed', () => {
    expect(relAt('select id fr|')[0].insertText).toBe('from')
    expect(relAt('SELECT id FR|')[0].insertText).toBe('FROM')
  })

  test('after a table the clause keywords come first', () => {
    const top = relAt('select * from orders o wh|').slice(0, 3).map((x) => x.label)
    expect(top).toContain('WHERE')
  })

  test('after WHERE an expression is expected, so columns lead', () => {
    expect(relAt('select * from orders where |')[0].kind).toBe('column')
  })
})

describe('usage ranking', () => {
  test('history counts tables and columns, recent use weighing more', () => {
    const now = Date.UTC(2026, 9, 21)
    const day = 86_400_000
    const u = computeUsage(
      [
        { sql: 'select status from orders', at: now, ok: true },
        { sql: 'select status from orders where id = 1', at: now - day, ok: true },
        { sql: 'select * from customers', at: now - 60 * day, ok: true },
        { sql: 'select * from products', at: now, ok: false }
      ],
      'postgres',
      now
    )
    expect(u.tables.get('orders')).toBeGreaterThan(u.tables.get('customers') ?? 0)
    expect(u.tables.has('products')).toBe(false)
    expect(u.columns.get('status')).toBeGreaterThan(1.9)
  })

  test('more used tables sort first after FROM', () => {
    const usage: Usage = { tables: new Map([['products', 5], ['orders', 1]]), columns: new Map() }
    expect(relAt('select * from |', usage).slice(0, 2).map((x) => x.label)).toEqual(['products', 'orders'])
  })

  test('more used columns sort first, then column order', () => {
    const usage: Usage = { tables: new Map(), columns: new Map([['status', 3]]) }
    expect(relAt('select o.| from orders o', usage).map((x) => x.label)).toEqual(['status', 'id', 'customer_id'])
  })
})

describe('foreign-key joins', () => {
  test('after JOIN the related tables come first, with the ON clause written', () => {
    const s = relAt('select * from orders o join |')
    const joins = s.filter((x) => x.kind === 'join')
    expect(joins.map((x) => x.insertText)).toEqual(expect.arrayContaining(['customers c on c.id = o.customer_id', 'order_items oi on oi.order_id = o.id']))
    expect(s[0].kind).toBe('join')
    expect(s.findIndex((x) => x.label === 'fleet_orders')).toBeGreaterThan(s.findIndex((x) => x.label === 'customers'))
  })

  test('ON is written in the case the user typed JOIN in', () => {
    const s = relAt('SELECT * FROM orders o JOIN |').filter((x) => x.kind === 'join')
    expect(s.map((x) => x.insertText)).toContain('customers c ON c.id = o.customer_id')
  })

  test('the generated alias avoids aliases already in use', () => {
    const s = relAt('select * from customers c join orders o on o.customer_id = c.id join |').filter((x) => x.kind === 'join')
    expect(s.map((x) => x.insertText)).toContain('order_items oi on oi.order_id = o.id')
    expect(s.find((x) => x.insertText.startsWith('orders '))?.insertText).toMatch(/^orders o2 /)
  })

  test('after ON the foreign-key condition is offered first', () => {
    const s = relAt('select * from orders o join customers c on |')
    expect(s[0]).toMatchObject({ kind: 'join', insertText: 'c.id = o.customer_id' })
  })
})
