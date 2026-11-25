import { describe, expect, it } from 'vitest'
import { typeKind } from './columnType'

describe('typeKind', () => {
  it.each([
    ['integer', 'number'],
    ['bigint', 'number'],
    ['numeric(10,2)', 'number'],
    ['double precision', 'number'],
    ['varchar(255)', 'text'],
    ['character varying', 'text'],
    ['TEXT', 'text'],
    ['uuid', 'text'],
    ['boolean', 'bool'],
    ['tinyint(1)', 'bool'],
    ['timestamp with time zone', 'date'],
    ['date', 'date'],
    ['interval', 'date'],
    ['jsonb', 'json'],
    ['bytea', 'binary'],
    ['blob', 'binary'],
    ['point', 'other'],
    ['', 'other']
  ])('%s → %s', (type, kind) => {
    expect(typeKind(type)).toBe(kind)
  })
})
