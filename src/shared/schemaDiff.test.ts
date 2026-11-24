import { describe, expect, it } from 'vitest'
import type { TableInfo } from './model'
import { diffSchemas, migrationSql } from './schemaDiff'

const col = (name: string, type: string, nullable = true, def: string | null = null) => ({ name, type, nullable, default: def, autoIncrement: false })
const table = (name: string, over: Partial<TableInfo> = {}): TableInfo => ({
  schema: 'public',
  name,
  kind: 'table',
  columns: [col('id', 'integer', false)],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [{ name: `${name}_pkey`, columns: ['id'], unique: true, primary: true }],
  ...over
})

const source: TableInfo[] = [
  table('orders', {
    columns: [col('id', 'integer', false), col('status', 'varchar(16)', false, "'new'"), col('channel', 'varchar(16)'), col('total', 'numeric(12,2)')],
    indexes: [
      { name: 'orders_pkey', columns: ['id'], unique: true, primary: true },
      { name: 'orders_status_idx', columns: ['status'], unique: false, primary: false }
    ],
    foreignKeys: [{ name: 'orders_customer_fk', columns: ['customer_id'], refSchema: 'public', refTable: 'customers', refColumns: ['id'] }]
  }),
  table('coupons')
]
const target: TableInfo[] = [
  table('orders', {
    schema: 'prod',
    columns: [col('id', 'integer', false), col('status', 'varchar(16)', true), col('total', 'numeric(10,2)'), col('legacy', 'text')],
    indexes: [{ name: 'orders_pk', columns: ['id'], unique: true, primary: true }]
  }),
  table('old_logs', { schema: 'prod' })
]

describe('diffSchemas', () => {
  const d = diffSchemas(source, target)
  it('finds tables only on one side', () => {
    expect(d).toContainEqual({ kind: 'table-added', table: 'coupons' })
    expect(d).toContainEqual({ kind: 'table-removed', table: 'old_logs' })
  })
  it('finds added, removed and changed columns', () => {
    expect(d).toContainEqual({ kind: 'column-added', table: 'orders', column: col('channel', 'varchar(16)') })
    expect(d).toContainEqual({ kind: 'column-removed', table: 'orders', column: 'legacy' })
    expect(d).toContainEqual(expect.objectContaining({ kind: 'column-changed', table: 'orders', column: 'status', changes: ['nullable', 'default'] }))
    expect(d).toContainEqual(expect.objectContaining({ kind: 'column-changed', table: 'orders', column: 'total', changes: ['type'] }))
  })
  it('compares indexes and foreign keys by columns, not by name', () => {
    expect(d.filter((x) => x.kind === 'index-added').map((x) => (x as { index: { name: string } }).index.name)).toEqual(['orders_status_idx'])
    expect(d.some((x) => x.kind === 'index-removed')).toBe(false) // primary keys named differently are the same key
    expect(d).toContainEqual(expect.objectContaining({ kind: 'fk-added', table: 'orders' }))
  })
  it('compares primary keys by columns, apart from indexes', () => {
    const s = [table('t', { primaryKey: ['a', 'b'] })]
    const t = [table('t', { primaryKey: ['a'], indexes: [] })]
    expect(diffSchemas(s, t)).toEqual([{ kind: 'pk-changed', table: 't', source: ['a', 'b'], target: ['a'] }])
  })
  it('reports nothing for identical schemas', () => {
    expect(diffSchemas(source, source)).toEqual([])
  })
})

describe('migrationSql', () => {
  const d = diffSchemas(source, target)
  it('writes PostgreSQL that makes the target match the source', () => {
    const sql = migrationSql(d, 'postgres', 'prod', new Map([['coupons', 'CREATE TABLE public.coupons (id integer NOT NULL);']]))
    expect(sql).toContain('ALTER TABLE prod.orders ADD COLUMN channel varchar(16);')
    expect(sql).toContain('ALTER TABLE prod.orders ALTER COLUMN total TYPE numeric(12,2);')
    expect(sql).toContain('ALTER TABLE prod.orders ALTER COLUMN status SET NOT NULL;')
    expect(sql).toContain("ALTER TABLE prod.orders ALTER COLUMN status SET DEFAULT 'new';")
    expect(sql).toContain('CREATE INDEX orders_status_idx ON prod.orders (status);')
    expect(sql).toContain('ALTER TABLE prod.orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES prod.customers (id);')
    expect(sql).toContain('CREATE TABLE public.coupons (id integer NOT NULL);')
  })
  it('never drops: what exists only in the target is commented out', () => {
    const sql = migrationSql(d, 'postgres', 'prod', new Map())
    expect(sql).toContain('-- ALTER TABLE prod.orders DROP COLUMN legacy;')
    expect(sql).toContain('-- DROP TABLE prod.old_logs;')
    expect(sql.split('\n').filter((l) => /^\s*(DROP|ALTER TABLE .* DROP)/.test(l))).toEqual([])
  })
  it('uses MODIFY COLUMN on MySQL', () => {
    expect(migrationSql(d, 'mysql', 'prod', new Map())).toContain("ALTER TABLE `prod`.`orders` MODIFY COLUMN `status` varchar(16) NOT NULL DEFAULT 'new';")
  })
  it('flags what SQLite cannot alter in place', () => {
    expect(migrationSql(d, 'sqlite', 'main', new Map())).toMatch(/-- SQLite cannot change column total in place/)
  })
})
