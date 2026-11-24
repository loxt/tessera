import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CellValue, Engine } from '@shared/model'
import { DbFailure, type Adapter, type DbSession, type ResolvedProfile } from './types'
import { postgres } from './postgres'
import { mysql, parseTreePlan } from './mysql'
import { sqlite } from './sqlite'

interface EngineCase {
  engine: Engine
  adapter: Adapter
  profile: () => ResolvedProfile
  schema: string
  /** placeholder for the n-th (1-based) parameter */
  ph: (n: number) => string
  customers: number
  version: RegExp
  syntaxCode: string
  /** null = cancel can't be exercised in this environment */
  sleepSql: string | null
}

const base = { id: 't', name: 't', hasPassword: true }
const pgProfile = (): ResolvedProfile => ({ ...base, engine: 'postgres', host: '127.0.0.1', port: 55432, user: 'tessera', password: 'tessera', database: 'shop' })
const myProfile = (): ResolvedProfile => ({ ...base, engine: 'mysql', host: '127.0.0.1', port: 53306, user: 'tessera', password: 'tessera', database: 'shop' })

let sqliteDir = ''
const sqliteFile = () => join(sqliteDir, 'shop.db')

async function reachable(adapter: Adapter, profile: ResolvedProfile): Promise<boolean> {
  try {
    await (await adapter.open(profile)).close()
    return true
  } catch {
    return false
  }
}

const cases: EngineCase[] = [
  {
    engine: 'postgres',
    adapter: postgres,
    profile: pgProfile,
    schema: 'public',
    ph: (n) => `$${n}`,
    customers: 30,
    version: /^PostgreSQL \d+\.\d+/,
    syntaxCode: '42601',
    sleepSql: 'select pg_sleep(10)'
  },
  {
    engine: 'mysql',
    adapter: mysql,
    profile: myProfile,
    schema: 'shop',
    ph: () => '?',
    customers: 20,
    version: /^MySQL \d+\.\d+\.\d+$/,
    syntaxCode: 'ER_PARSE_ERROR',
    sleepSql: 'select sleep(10)'
  },
  {
    engine: 'sqlite',
    adapter: sqlite,
    profile: () => ({ ...base, engine: 'sqlite', file: sqliteFile() }),
    schema: 'main',
    ph: () => '?',
    customers: 30,
    version: /^SQLite 3\.\d+/,
    syntaxCode: '1',
    // Under vitest the session runs in-process (no compiled worker), where cancel is a documented no-op.
    sleepSql: null
  }
]

const up: Record<Engine, boolean> = {
  postgres: await reachable(postgres, pgProfile()),
  mysql: await reachable(mysql, myProfile()),
  sqlite: true
}

beforeAll(() => {
  sqliteDir = mkdtempSync(join(tmpdir(), 'tessera-sqlite-'))
  const db = new DatabaseSync(sqliteFile())
  db.exec(readFileSync(resolve('fixtures/sqlite.sql'), 'utf8'))
  db.close()
})
afterAll(() => rmSync(sqliteDir, { recursive: true, force: true }))

const failure = async (p: Promise<unknown>): Promise<DbFailure> => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err
  )
  expect(e).toBeInstanceOf(DbFailure)
  return e as DbFailure
}

for (const c of cases) {
  const label = up[c.engine] ? c.engine : `${c.engine} (skipped: database unreachable — run \`npm run db:up\`)`
  describe.skipIf(!up[c.engine])(label, () => {
    let s: DbSession
    const { adapter, schema } = c
    const one = async (sql: string, params?: CellValue[]) => (await s.query(sql, params)).rows[0]?.[0]

    beforeAll(async () => {
      s = await adapter.open(c.profile())
    })
    afterAll(async () => {
      await s?.close()
      await s?.close() // idempotent
    })

    it('reports the server version', async () => {
      expect(await adapter.serverVersion(s)).toMatch(c.version)
    })

    it('fetches with limit / hasMore and without limit', async () => {
      const limited = await s.query('select id, name from customers order by id', [], 5)
      expect(limited).toMatchObject({ returnsRows: true, hasMore: true })
      expect(limited.rows).toHaveLength(5)
      expect(limited.columns.map((col) => col.name)).toEqual(['id', 'name'])
      expect(limited.columns[0].type).not.toBe('')
      const exact = await s.query('select id from customers', [], c.customers)
      expect(exact.rows).toHaveLength(c.customers)
      expect(exact.hasMore).toBe(false)
      const all = await s.query('select id from customers')
      expect(all.rows).toHaveLength(c.customers)
      const empty = await s.query('select id from customers where 1 = 0')
      expect(empty).toMatchObject({ returnsRows: true, rows: [], hasMore: false })
    })

    const numbers = 'with recursive n(i) as (select 1 union all select i + 1 from n where i < 2500) select i from n'

    it('streams every row in batches, waiting for the sink', async () => {
      if (c.engine === 'mysql') await s.query('SET SESSION cte_max_recursion_depth = 3000')
      const sizes: number[] = []
      let sum = 0
      await s.stream(numbers, [], async (rows, columns) => {
        expect(columns.map((col) => col.name)).toEqual(['i'])
        sizes.push(rows.length)
        for (const r of rows) sum += Number(r[0])
        await new Promise((r) => setTimeout(r, 5)) // a slow disk
      })
      expect(sizes).toEqual([1000, 1000, 500])
      expect(sum).toBe((2500 * 2501) / 2)
      expect(Number(await one('select 1'))).toBe(1)
    })

    it('leaves the session usable when the sink fails mid-stream', async () => {
      await expect(
        s.stream(numbers, [], async () => {
          throw new Error('disk full')
        })
      ).rejects.toThrow('disk full')
      expect(Number(await one('select 1'))).toBe(1)
    })

    it('rejects a failing streamed statement without hanging the session', async () => {
      await failure(s.stream('select * from no_such_table', [], async () => {}))
      expect(Number(await one('select 1'))).toBe(1)
    })

    it('reports affected rows for DML', async () => {
      const ins = await s.query(`insert into audit_log (msg) values (${c.ph(1)})`, ['test-dml'])
      expect(ins).toMatchObject({ returnsRows: false, affected: 1 })
      expect(ins.command).toMatch(/INSERT/i)
      const del = await s.query(`delete from audit_log where msg = ${c.ph(1)}`, ['test-dml'])
      expect(del.affected).toBe(1)
    })

    it('keeps exact numerics, timestamps and unicode lossless', async () => {
      const [big, price] = (await s.query('select big_counter, price from products where id = 1')).rows[0]
      expect(big).toBe('9007199254740993')
      expect(String(price)).toMatch(/^3\.25?$/)
      expect(await one('select id from customers where id = 1')).toBe(1)
      expect(await one('select created_at from customers where id = 1')).toBe('2024-01-02 09:00:00')
      expect(await one('select name from customers where id = 1')).toBe('Zoë Ångström 日本語 🚀')
      expect(await one('select title from products where id = 2')).toHaveLength(4600)
      expect(await one('select email from customers where id = 7')).toBeNull()
    })

    it('normalizes binary values and binds parameters', async () => {
      expect(await one('select image from products where id = 1')).toEqual({ $t: 'binary', hex: '01cafe', size: 3 })
      expect(await one(`select name from customers where id = ${c.ph(1)}`, [2])).toBe('Customer 2')
      const bin = { $t: 'binary', hex: 'beef', size: 2 } as const
      expect(await one(`select ${c.ph(1)}${c.engine === 'postgres' ? '::bytea' : ''} as b`, [bin])).toEqual(bin)
    })

    it('maps errors to DbFailure', async () => {
      const e = await failure(s.query('select * fron customers'))
      expect(e.dbError.code).toBe(c.syntaxCode)
      expect(e.dbError.message).not.toBe('')
      if (c.engine === 'postgres') expect(e.dbError.position).toBeGreaterThan(0)
      expect(Number(await one('select 1'))).toBe(1) // session still usable
    })

    it('tracks explicit transactions', async () => {
      expect(s.inTransaction).toBe(false)
      await s.query(adapter.beginSql)
      expect(s.inTransaction).toBe(true)
      await s.query('insert into audit_log (msg) values (null)')
      await s.query('ROLLBACK')
      expect(s.inTransaction).toBe(false)
    })

    it('lists explorer children at every level', async () => {
      const schemas = await adapter.listChildren(s, null, false)
      expect(schemas.map((n) => n.id)).toContain(`schema:${schema}`)
      if (c.engine === 'postgres') {
        expect(schemas.map((n) => n.name)).toContain('analytics')
        expect(schemas.map((n) => n.name)).not.toContain('pg_catalog')
        expect((await adapter.listChildren(s, null, true)).map((n) => n.name)).toContain('pg_catalog')
      }
      const folders = await adapter.listChildren(s, { schema }, false)
      expect(folders.map((n) => n.name)).toEqual(expect.arrayContaining(['tables', 'views']))
      expect(folders[0]).toMatchObject({ kind: 'folder', id: `folder:${schema}/tables`, hasChildren: true })

      const tables = await adapter.listChildren(s, { schema, folder: 'tables' }, false)
      expect(tables.map((n) => n.name)).toEqual(['audit_log', 'customers', 'order_items', 'orders', 'products'])
      expect(tables[1]).toMatchObject({ id: `table:${schema}/customers`, kind: 'table', path: { schema, table: 'customers' }, hasChildren: true })
      const views = await adapter.listChildren(s, { schema, folder: 'views' }, false)
      expect(views).toMatchObject([{ kind: 'view', name: 'order_totals', hasChildren: true }])
      if (c.engine !== 'sqlite') {
        const routines = await adapter.listChildren(s, { schema, folder: 'routines' }, false)
        expect(routines).toMatchObject([{ kind: 'routine', name: 'order_count', hasChildren: false }])
        expect(routines[0].detail).toMatch(/cid/)
      }

      const tableFolders = await adapter.listChildren(s, { schema, table: 'orders' }, false)
      expect(tableFolders.map((n) => n.name)).toEqual(['columns', 'keys', 'fks', 'indexes'])
      expect((await adapter.listChildren(s, { schema, table: 'order_totals' }, false)).map((n) => n.name)).toEqual(['columns'])

      const columns = await adapter.listChildren(s, { schema, table: 'customers', folder: 'columns' }, false)
      expect(columns.find((n) => n.name === 'email')).toMatchObject({ id: `column:${schema}/customers/email`, kind: 'column', hasChildren: false })
      expect(columns.find((n) => n.name === 'name')?.detail).toMatch(/NOT NULL$/)
      const keys = await adapter.listChildren(s, { schema, table: 'customers', folder: 'keys' }, false)
      expect(keys.length).toBe(2) // PK + unique(email)
      expect(keys.map((k) => k.detail)).toContain('(email)')
      const fks = await adapter.listChildren(s, { schema, table: 'orders', folder: 'fks' }, false)
      expect(fks).toHaveLength(1)
      expect(fks[0].detail).toBe('(customer_id) → customers(id)')
      const indexes = await adapter.listChildren(s, { schema, table: 'orders', folder: 'indexes' }, false)
      expect(indexes.find((n) => n.name === 'orders_customer_id_idx')).toMatchObject({ kind: 'index', detail: '(customer_id)' })
    })

    it('describes tables', async () => {
      const customers = await adapter.tableInfo(s, schema, 'customers')
      expect(customers).toMatchObject({ schema, name: 'customers', kind: 'table', primaryKey: ['id'] })
      expect(customers.columns.map((col) => col.name)).toEqual(['id', 'name', 'email', 'created_at', 'active'])
      expect(customers.columns[0].autoIncrement).toBe(true)
      expect(customers.columns.find((col) => col.name === 'email')).toMatchObject({ type: expect.stringMatching(/(varchar|character varying)\(255\)/i), nullable: true })
      expect(customers.columns.find((col) => col.name === 'name')?.nullable).toBe(false)
      expect(customers.rowid).toBeUndefined()

      const items = await adapter.tableInfo(s, schema, 'order_items')
      expect(items.primaryKey).toEqual(['order_id', 'product_id'])
      expect(items.foreignKeys.map((f) => [f.columns, f.refTable, f.refColumns]).sort()).toEqual([
        [['order_id'], 'orders', ['id']],
        [['product_id'], 'products', ['id']]
      ])
      expect(items.indexes.find((i) => i.primary)?.columns ?? items.primaryKey).toEqual(['order_id', 'product_id'])

      const audit = await adapter.tableInfo(s, schema, 'audit_log')
      expect(audit.primaryKey).toEqual([])
      expect(audit.rowid).toBe(c.engine === 'sqlite' ? true : undefined)

      expect((await adapter.tableInfo(s, schema, 'order_totals')).kind).toBe('view')
      const products = await adapter.tableInfo(s, schema, 'products')
      expect(products.columns.find((col) => col.name === 'price')?.type).toMatch(/numeric\(10,2\)|decimal\(10,2\)/i)
    })

    it('produces DDL', async () => {
      const table = await adapter.ddl(s, 'table', schema, 'orders')
      expect(table).toMatch(/CREATE TABLE/i)
      expect(table).toMatch(/customer_id/)
      expect(table.trim().endsWith(';')).toBe(true)
      expect(await adapter.ddl(s, 'view', schema, 'order_totals')).toMatch(/CREATE .*VIEW/i)
      if (c.engine !== 'sqlite') expect(await adapter.ddl(s, 'routine', schema, 'order_count')).toMatch(/CREATE .*(FUNCTION|PROCEDURE)/i)
      if (c.engine === 'postgres') {
        expect(await adapter.ddl(s, 'sequence', schema, 'invoice_seq')).toMatch(/CREATE SEQUENCE .* INCREMENT BY 10 .* START WITH 1000/)
        const customers = await adapter.ddl(s, 'table', schema, 'customers')
        expect(customers).toMatch(/GENERATED BY DEFAULT AS IDENTITY/)
        expect(customers).toMatch(/COMMENT ON TABLE .* IS 'People who buy things';/)
      }
    })

    it('collects completion metadata', async () => {
      const md = await adapter.metadata(s, false)
      expect(md.defaultSchema).toBe(schema)
      expect(md.schemas).toContain(schema)
      const customers = md.tables.find((t) => t.schema === schema && t.name === 'customers')
      expect(customers).toMatchObject({ kind: 'table', columns: ['id', 'name', 'email', 'created_at', 'active'] })
      expect(md.tables.find((t) => t.name === 'order_totals')?.kind).toBe('view')
      expect(md.foreignKeys).toContainEqual({ schema, table: 'orders', columns: ['customer_id'], refSchema: schema, refTable: 'customers', refColumns: ['id'] })
      expect(md.foreignKeys).toContainEqual({ schema, table: 'order_items', columns: ['order_id'], refSchema: schema, refTable: 'orders', refColumns: ['id'] })
    })

    it.skipIf(c.engine === 'sqlite')('leaves hidden schemas out of completion metadata', async () => {
      const md = await adapter.metadata(s, false, [schema])
      expect(md.tables.some((t) => t.schema === schema)).toBe(false)
      expect((md.foreignKeys ?? []).some((fk) => fk.schema === schema)).toBe(false)
    })

    it('explains queries', async () => {
      const sql = 'select c.name, count(*) from customers c join orders o on o.customer_id = c.id group by c.name'
      const plan = await adapter.explain(s, sql, false)
      expect(plan.length).toBeGreaterThan(0)
      expect(plan[0].label).not.toBe('')
      const analyzed = await adapter.explain(s, `delete from audit_log where msg is not null`, true)
      expect(analyzed.length).toBeGreaterThan(0)
      expect(s.inTransaction).toBe(false)
      expect(await one('select count(*) from audit_log')).toEqual(c.engine === 'mysql' ? '3' : c.engine === 'postgres' ? '3' : 3)
    })

    it.skipIf(!c.sleepSql)('cancels a running query quickly', async () => {
      const started = Date.now()
      const running = s.query(c.sleepSql!).then(
        () => 'resolved',
        (e: unknown) => (e instanceof DbFailure ? 'rejected' : 'other')
      )
      await new Promise((r) => setTimeout(r, 300))
      await s.cancel()
      // MySQL answers 1 for an interrupted SLEEP(); PostgreSQL raises 57014
      expect(await running).toBe(c.engine === 'postgres' ? 'rejected' : 'resolved')
      expect(Date.now() - started).toBeLessThan(3000)
      await s.cancel() // idle: no-op
      expect(Number(await one('select 1'))).toBe(1)
    })

    it('enforces read-only sessions on the server', async () => {
      const ro = await adapter.open({ ...c.profile(), readOnly: true })
      try {
        await failure(ro.query("insert into audit_log (msg) values ('nope')"))
        expect((await ro.query('select count(*) from customers')).rows).toHaveLength(1)
      } finally {
        await ro.close()
      }
    })

    if (c.engine !== 'mysql') {
      it('returns rows from INSERT … RETURNING', async () => {
        await s.query(adapter.beginSql)
        const out = await s.query("insert into audit_log (msg) values ('r1'), ('r2') returning msg", [], 1)
        expect(out).toMatchObject({ returnsRows: true, rows: [['r1']], hasMore: true })
        expect(await one("select count(*) from audit_log where msg like 'r_'")).toEqual(c.engine === 'postgres' ? '2' : 2)
        await s.query('ROLLBACK')
      })
    }
  })
}

describe('parseTreePlan', () => {
  it('nests MySQL tree output by indentation', () => {
    const text = [
      '-> Nested loop inner join  (cost=4.5 rows=10) (actual time=0.1..0.3 rows=8 loops=1)',
      '    -> Table scan on c  (cost=1.25 rows=10)',
      '    -> Index lookup on o using idx (customer_id=c.id)  (cost=0.25 rows=1)'
    ].join('\n')
    const [root] = parseTreePlan(text)
    expect(root).toMatchObject({ label: 'Nested loop inner join', cost: 4.5, rows: 8, time: 0.3 })
    expect(root.children.map((n) => n.label)).toEqual(['Table scan on c', 'Index lookup on o using idx (customer_id=c.id)'])
  })
})
