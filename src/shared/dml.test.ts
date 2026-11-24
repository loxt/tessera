import { describe, expect, test } from 'vitest'
import { generateDml, inlineParams, literal, quoteIdent, type ChangeSet } from './dml'

const base: ChangeSet = { schema: 'public', table: 'users', keyColumns: ['id'], updates: [], inserts: [], deletes: [] }

describe('quoteIdent', () => {
  test('uses dialect quoting and escapes embedded quotes', () => {
    expect(quoteIdent('we"ird', 'postgres')).toBe('"we""ird"')
    expect(quoteIdent('we`ird', 'mysql')).toBe('`we``ird`')
  })
})

describe('literal', () => {
  test('renders values per dialect', () => {
    expect(literal(null, 'postgres')).toBe('NULL')
    expect(literal("it's", 'mysql')).toBe("'it''s'")
    expect(literal(true, 'postgres')).toBe('TRUE')
    expect(literal(true, 'sqlite')).toBe('1')
    expect(literal({ $t: 'binary', hex: 'cafe', size: 2 }, 'postgres')).toBe("'\\xcafe'::bytea")
    expect(literal({ $t: 'binary', hex: 'cafe', size: 2 }, 'mysql')).toBe("X'cafe'")
  })
  test('escapes backslashes for MySQL string literals', () => {
    expect(literal('a\\b', 'mysql')).toBe("'a\\\\b'")
  })
  test('PostgreSQL strings with backslashes use E-strings (safe even with standard_conforming_strings=off)', () => {
    expect(literal("\\' OR 1=1 --", 'postgres')).toBe("E'\\\\'' OR 1=1 --'")
    expect(literal('a\\b', 'sqlite')).toBe("'a\\b'")
  })
})

describe('generateDml', () => {
  test('parameterized UPDATE keyed by primary key', () => {
    const out = generateDml({ ...base, updates: [{ key: [7], set: { name: 'Ann', age: null } }] }, 'postgres')
    expect(out).toEqual([{ sql: 'UPDATE "public"."users" SET "name" = $1, "age" = $2 WHERE "id" = $3', params: ['Ann', null, 7], expectOne: true }])
  })

  test('NULL key values use IS NULL instead of a parameter', () => {
    const out = generateDml({ ...base, keyColumns: ['a', 'b'], deletes: [[1, null]] }, 'mysql')
    expect(out[0].sql).toBe('DELETE FROM `public`.`users` WHERE `a` = ? AND `b` IS NULL')
    expect(out[0].params).toEqual([1])
  })

  test('INSERT with values, and DEFAULT VALUES for empty rows', () => {
    const out = generateDml({ ...base, inserts: [{ name: 'Bo' }, {}] }, 'sqlite')
    expect(out[0]).toEqual({ sql: 'INSERT INTO "public"."users" ("name") VALUES (?)', params: ['Bo'], expectOne: false })
    expect(out[1].sql).toBe('INSERT INTO "public"."users" DEFAULT VALUES')
    expect(generateDml({ ...base, inserts: [{}] }, 'mysql')[0].sql).toBe('INSERT INTO `public`.`users` () VALUES ()')
  })

  test('orders statements: updates, deletes, inserts', () => {
    const out = generateDml({ ...base, updates: [{ key: [1], set: { a: 1 } }], deletes: [[2]], inserts: [{ a: 3 }] }, 'postgres')
    expect(out.map((s) => s.sql.split(' ')[0])).toEqual(['UPDATE', 'DELETE', 'INSERT'])
  })

  test('refuses changes without key columns', () => {
    expect(() => generateDml({ ...base, keyColumns: [], deletes: [[1]] }, 'postgres')).toThrow(/primary key/i)
  })
})

describe('inlineParams', () => {
  test('renders a readable preview', () => {
    expect(inlineParams('UPDATE t SET a = $1 WHERE id = $2', ["x'y", 3], 'postgres')).toBe("UPDATE t SET a = 'x''y' WHERE id = 3")
    expect(inlineParams('DELETE FROM t WHERE a = ? AND b = ?', [1, null], 'mysql')).toBe('DELETE FROM t WHERE a = 1 AND b = NULL')
  })
  test('does not confuse $1 with $10', () => {
    const params = Array.from({ length: 10 }, (_, i) => i + 1)
    expect(inlineParams('$1 $10', params, 'postgres')).toBe('1 10')
  })
})
