import { describe, expect, test } from 'vitest'
import type { TableInfo } from '@shared/model'
import { singleTableSource, whyReadOnly } from './editable'

describe('singleTableSource', () => {
  test('plain selects from one table are editable sources', () => {
    expect(singleTableSource('select * from supplier.supplier where status = $1', 'postgres')).toEqual({ schema: 'supplier', table: 'supplier' })
    expect(singleTableSource('-- recent\nSELECT id, name FROM customers c ORDER BY id LIMIT 10', 'postgres')).toEqual({ table: 'customers', alias: 'c' })
  })

  test('joins, aggregates, set operations, CTEs and subqueries are not', () => {
    for (const sql of [
      'select * from a join b on b.id = a.b_id',
      'select * from a, b',
      'select status, count(*) from a group by status',
      'select distinct status from a',
      'select * from a union select * from b',
      'with x as (select 1) select * from x',
      'select * from (select * from a) t',
      'update a set x = 1',
      'select 1'
    ]) {
      expect(singleTableSource(sql, 'postgres'), sql).toBeNull()
    }
  })

  test('keywords inside strings and comments do not count', () => {
    expect(singleTableSource("select * from notes where body = 'a join b' -- group by", 'postgres')).toEqual({ table: 'notes' })
  })
})

const info: TableInfo = {
  schema: 'public',
  name: 'supplier',
  kind: 'table',
  columns: [{ name: 'id' }, { name: 'name' }, { name: 'status' }] as TableInfo['columns'],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: []
}
const cols = (...names: string[]) => names.map((name) => ({ name, type: 'text' }))

describe('whyReadOnly', () => {
  test('a result of real columns including the key is editable', () => {
    expect(whyReadOnly(cols('id', 'name'), info)).toBeNull()
  })

  test('explains what blocks editing', () => {
    expect(whyReadOnly(cols('name'), info)).toMatch(/primary key id/)
    expect(whyReadOnly(cols('id', 'upper'), info)).toMatch(/"upper" is not a column/)
    expect(whyReadOnly(cols('id', 'id'), info)).toMatch(/duplicate/)
    expect(whyReadOnly(cols('id'), { ...info, primaryKey: [] })).toMatch(/no primary key/)
    expect(whyReadOnly(cols('id'), { ...info, kind: 'view' })).toMatch(/view/)
  })
})
