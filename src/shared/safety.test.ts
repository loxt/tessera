import { describe, expect, it } from 'vitest'
import { assessRisk, confirmationFor } from './safety'

describe('assessRisk', () => {
  it('lets reads through', () => {
    for (const sql of ['select * from t', 'with x as (select 1) select * from x', 'explain select 1', 'show tables', 'pragma table_info(t)']) {
      expect(assessRisk(sql, 'postgres').level).toBe('read')
    }
  })

  it('flags writes', () => {
    expect(assessRisk("update t set a = 1 where id = 2", 'postgres')).toEqual({ level: 'write' })
    expect(assessRisk('insert into t values (1)', 'mysql').level).toBe('write')
    expect(assessRisk('create index i on t (a)', 'postgres').level).toBe('write')
    expect(assessRisk('with d as (delete from t where id = 1 returning *) select * from d', 'postgres').level).toBe('write')
  })

  it('calls out UPDATE and DELETE without WHERE, ignoring WHERE inside subqueries, strings and comments', () => {
    expect(assessRisk('delete from orders', 'postgres')).toEqual({ level: 'dangerous', reason: 'DELETE without WHERE changes every row of orders' })
    expect(assessRisk("update orders set status = 'x' -- where id = 1", 'postgres')).toMatchObject({ level: 'dangerous' })
    expect(assessRisk("update orders set note = 'where'", 'postgres')).toMatchObject({ level: 'dangerous' })
    expect(assessRisk('update orders set total = (select sum(x) from items where items.o = 1)', 'postgres')).toMatchObject({ level: 'dangerous' })
    expect(assessRisk('delete from orders where id in (select id from old)', 'postgres').level).toBe('write')
  })

  it('calls out DROP and TRUNCATE', () => {
    expect(assessRisk('drop table customers', 'postgres')).toEqual({ level: 'dangerous', reason: 'DROP removes customers' })
    expect(assessRisk('truncate table audit_log', 'mysql')).toEqual({ level: 'dangerous', reason: 'TRUNCATE empties audit_log' })
    expect(assessRisk('alter table t drop column c', 'postgres')).toMatchObject({ level: 'dangerous' })
  })
})

describe('assessRisk: statements that look like reads but change state', () => {
  it('sees a write behind CTEs, including one without WHERE', () => {
    expect(assessRisk('with x as (select 1) delete from orders', 'postgres')).toMatchObject({ level: 'dangerous' })
    expect(assessRisk('with x as (select 1) update orders set a = 1 where id = 2', 'postgres').level).toBe('write')
    expect(assessRisk('with x as (select 1) select * from x for update', 'postgres')).toEqual({ level: 'write' })
  })

  it('treats EXPLAIN ANALYZE of DML as that DML', () => {
    expect(assessRisk('explain analyze delete from orders', 'postgres')).toMatchObject({ level: 'dangerous' })
    expect(assessRisk('explain analyze update orders set a = 1 where id = 1', 'postgres').level).toBe('write')
    expect(assessRisk('explain delete from orders', 'postgres').level).toBe('read')
  })

  it('flags SELECT … INTO, locking reads and side-effect functions', () => {
    expect(assessRisk('select * into backup_orders from orders', 'postgres').level).toBe('write')
    expect(assessRisk("select * from orders into outfile '/tmp/x'", 'mysql').level).toBe('write')
    expect(assessRisk('select * from orders for update', 'postgres').level).toBe('write')
    expect(assessRisk('select pg_terminate_backend(123)', 'postgres').level).toBe('write')
    expect(assessRisk("select nextval('orders_id_seq')", 'postgres').level).toBe('write')
    expect(assessRisk("select 'nextval(' as text", 'postgres').level).toBe('read')
  })

  it('flags PRAGMA assignments and server-wide SET', () => {
    expect(assessRisk('pragma journal_mode = wal', 'sqlite').level).toBe('write')
    expect(assessRisk('pragma table_info(t)', 'sqlite').level).toBe('read')
    expect(assessRisk('set global max_connections = 10', 'mysql').level).toBe('write')
    expect(assessRisk('set role admin', 'postgres').level).toBe('write')
    expect(assessRisk('set search_path to public', 'postgres').level).toBe('read')
  })

  it('reads through leading parentheses and treats what it cannot recognise as a write', () => {
    expect(assessRisk('(select 1) union (select 2)', 'postgres').level).toBe('read')
    expect(assessRisk('call refresh_everything()', 'mysql').level).toBe('write')
    expect(assessRisk('do $$ begin delete from t; end $$', 'postgres').level).toBe('write')
  })
})

describe('confirmationFor', () => {
  const read = 'select 1'
  const write = 'update t set a = 1 where id = 1'
  const nuke = 'delete from t'

  it('asks nothing for reads, anywhere', () => {
    expect(confirmationFor([read], 'postgres', 'production', false)).toBeNull()
  })

  it('asks before dangerous statements everywhere, and makes production type the name', () => {
    expect(confirmationFor([nuke], 'postgres', undefined, false)).toMatchObject({ typed: false })
    expect(confirmationFor([nuke], 'postgres', 'production', false)).toMatchObject({ typed: true })
  })

  it('asks before any write in production, listing the statements', () => {
    const c = confirmationFor([read, write], 'postgres', 'production', false)
    expect(c).toMatchObject({ typed: false })
    expect(c?.statements).toEqual([write])
    expect(confirmationFor([write], 'postgres', 'staging', false)).toBeNull()
  })

  it('leaves read-only data sources to the server', () => {
    expect(confirmationFor([nuke], 'postgres', 'production', true)).toBeNull()
  })
})
