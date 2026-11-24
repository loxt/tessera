import { describe, expect, it } from 'vitest'
import { buildWhere, columnKind, describeCondition, needsValue, opsFor, type Condition } from './filter'

const cols = [
  { name: 'id', type: 'integer' },
  { name: 'name', type: 'text' },
  { name: 'email', type: 'varchar(255)' },
  { name: 'created_at', type: 'timestamp' },
  { name: 'active', type: 'boolean' },
  { name: 'data', type: 'jsonb' }
]
const c = (column: string, op: Condition['op'], value?: string): Condition => ({ column, op, value })

describe('columnKind', () => {
  it('classifies common database types', () => {
    expect(columnKind('integer')).toBe('number')
    expect(columnKind('numeric(10,2)')).toBe('number')
    expect(columnKind('varchar(255)')).toBe('text')
    expect(columnKind('TEXT NOT NULL')).toBe('text')
    expect(columnKind('timestamp')).toBe('date')
    expect(columnKind('datetime')).toBe('date')
    expect(columnKind('boolean')).toBe('bool')
    expect(columnKind('tinyint(1)')).toBe('bool')
    expect(columnKind('jsonb')).toBe('other')
  })
})

describe('opsFor', () => {
  it('offers text matching only on text columns', () => {
    expect(opsFor('text')).toContain('contains')
    expect(opsFor('number')).not.toContain('contains')
    expect(opsFor('date')).toContain('lastDays')
    expect(opsFor('bool')).toEqual(['isTrue', 'isFalse', 'isNull', 'notNull'])
  })
})

describe('needsValue', () => {
  it('knows which operators take no value', () => {
    expect(needsValue('isNull')).toBe(false)
    expect(needsValue('isTrue')).toBe(false)
    expect(needsValue('eq')).toBe(true)
  })
})

describe('buildWhere', () => {
  it('returns an empty clause for no conditions', () => {
    expect(buildWhere([], cols, 'postgres')).toBe('')
  })

  it('joins conditions with AND and quotes identifiers per engine', () => {
    const conds = [c('name', 'eq', "O'Brien"), c('id', 'gt', '10')]
    expect(buildWhere(conds, cols, 'postgres')).toBe(`"name" = 'O''Brien' AND "id" > 10`)
    expect(buildWhere(conds, cols, 'mysql')).toBe("`name` = 'O''Brien' AND `id` > 10")
  })

  it('matches text case-insensitively and escapes LIKE wildcards', () => {
    expect(buildWhere([c('email', 'contains', '50%_off')], cols, 'postgres')).toBe(`"email" ILIKE '%50!%!_off%' ESCAPE '!'`)
    expect(buildWhere([c('email', 'startsWith', 'a!b')], cols, 'sqlite')).toBe(`"email" LIKE 'a!!b%' ESCAPE '!'`)
    expect(buildWhere([c('email', 'notContains', 'x')], cols, 'mysql')).toBe("`email` NOT LIKE '%x%' ESCAPE '!'")
  })

  it('handles NULL and boolean operators without a value', () => {
    expect(buildWhere([c('email', 'isNull')], cols, 'postgres')).toBe('"email" IS NULL')
    expect(buildWhere([c('email', 'notNull')], cols, 'postgres')).toBe('"email" IS NOT NULL')
    expect(buildWhere([c('active', 'isTrue')], cols, 'postgres')).toBe('"active" = TRUE')
    expect(buildWhere([c('active', 'isFalse')], cols, 'sqlite')).toBe('"active" = 0')
  })

  it('writes "in the last N days" in each dialect', () => {
    expect(buildWhere([c('created_at', 'lastDays', '30')], cols, 'postgres')).toBe(`"created_at" >= now() - interval '30 days'`)
    expect(buildWhere([c('created_at', 'lastDays', '7')], cols, 'mysql')).toBe('`created_at` >= NOW() - INTERVAL 7 DAY')
    expect(buildWhere([c('created_at', 'lastDays', '1')], cols, 'sqlite')).toBe(`"created_at" >= datetime('now', '-1 days')`)
  })

  it('compares dates as literals', () => {
    expect(buildWhere([c('created_at', 'lt', '2024-01-05')], cols, 'postgres')).toBe(`"created_at" < '2024-01-05'`)
  })

  it('rejects values that do not fit the column', () => {
    expect(() => buildWhere([c('id', 'eq', '12abc')], cols, 'postgres')).toThrow(/not a number/)
    expect(() => buildWhere([c('created_at', 'lastDays', '-3')], cols, 'postgres')).toThrow(/whole number of days/)
    expect(() => buildWhere([c('name', 'eq', '')], cols, 'postgres')).toThrow(/needs a value/)
    expect(() => buildWhere([c('missing', 'eq', 'x')], cols, 'postgres')).toThrow(/no column "missing"/)
  })
})

describe('describeCondition', () => {
  it('reads like a sentence', () => {
    expect(describeCondition(c('name', 'contains', 'ana'), cols)).toBe('name contains "ana"')
    expect(describeCondition(c('created_at', 'lastDays', '30'), cols)).toBe('created_at in the last 30 days')
    expect(describeCondition(c('created_at', 'gt', '2024-01-01'), cols)).toBe('created_at after "2024-01-01"')
    expect(describeCondition(c('id', 'gte', '5'), cols)).toBe('id ≥ 5')
    expect(describeCondition(c('email', 'isNull'), cols)).toBe('email is NULL')
  })
})
