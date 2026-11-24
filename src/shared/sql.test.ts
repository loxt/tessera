import { describe, expect, test } from 'vitest'
import { bindParams, findParams, splitStatements, statementAt } from './sql'

const texts = (sql: string, engine: 'postgres' | 'mysql' | 'sqlite' = 'postgres') =>
  splitStatements(sql, engine).map((s) => s.text)

describe('splitStatements', () => {
  test('splits on semicolons and trims, skipping empty statements', () => {
    expect(texts('select 1;  select 2 ;;\n\n')).toEqual(['select 1', 'select 2'])
  })

  test('keeps offsets pointing at the trimmed text in the original source', () => {
    const sql = '  select 1;\n  select 2'
    const [a, b] = splitStatements(sql, 'postgres')
    expect(sql.slice(a.start, a.end)).toBe('select 1')
    expect(sql.slice(b.start, b.end)).toBe('select 2')
  })

  test('ignores semicolons in strings, identifiers and comments', () => {
    const sql = `select ';' as "a;b", 1 -- x;y\n; /* ; */ select 'it''s;'`
    expect(texts(sql)).toEqual([`select ';' as "a;b", 1 -- x;y`, `/* ; */ select 'it''s;'`])
  })

  test('skips statements made only of comments', () => {
    expect(texts('-- just a note\n;\nselect 1')).toEqual(['select 1'])
  })

  test('handles PostgreSQL dollar quoting', () => {
    const fn = `create function f() returns int as $body$ begin; return 1; end $body$ language plpgsql`
    expect(texts(`${fn}; select 2`)).toEqual([fn, 'select 2'])
    expect(texts(`do $$ begin perform 1; end $$; select 3`)).toEqual(['do $$ begin perform 1; end $$', 'select 3'])
  })

  test('does not treat $1 parameters as dollar quotes', () => {
    expect(texts('select $1; select $2')).toEqual(['select $1', 'select $2'])
  })

  test('handles MySQL backslash escapes, backticks and # comments', () => {
    const sql = "select 'a\\';b' from `t;x` # c;\n; select 2"
    expect(texts(sql, 'mysql')).toEqual(["select 'a\\';b' from `t;x` # c;", 'select 2'])
  })

  test('supports the MySQL DELIMITER directive', () => {
    const sql = 'DELIMITER //\ncreate procedure p() begin select 1; select 2; end//\nDELIMITER ;\nselect 3;'
    expect(texts(sql, 'mysql')).toEqual(['create procedure p() begin select 1; select 2; end', 'select 3'])
  })

  test('keeps mysqldump-style CREATE DEFINER=… PROCEDURE bodies intact', () => {
    const quoted = 'CREATE DEFINER=`root`@`localhost` PROCEDURE p() BEGIN SELECT 1; SELECT 2; END'
    const bare = 'CREATE DEFINER = root@localhost FUNCTION f() RETURNS INT BEGIN IF 1 THEN RETURN 1; END IF; RETURN 2; END'
    expect(texts(`${quoted}; ${bare}; select 3`, 'mysql')).toEqual([quoted, bare, 'select 3'])
  })

  test('MySQL needs whitespace after -- for a comment', () => {
    expect(texts('SELECT 5--1; SELECT 2', 'mysql')).toEqual(['SELECT 5--1', 'SELECT 2'])
    expect(texts('SELECT 1 -- note; x\n; SELECT 2', 'mysql')).toEqual(['SELECT 1 -- note; x', 'SELECT 2'])
  })

  test('keeps SQLite trigger bodies intact', () => {
    const trg = 'create trigger t after insert on a begin update b set x = case when 1 then 2 end; delete from c; end'
    expect(texts(`${trg}; select 1`, 'sqlite')).toEqual([trg, 'select 1'])
  })
})

describe('statementAt', () => {
  const sql = 'select 1;\n\nselect 2;\nselect 3'
  const stmts = splitStatements(sql, 'postgres')
  test('returns the statement containing the caret', () => {
    expect(statementAt(stmts, sql.indexOf('2'))?.text).toBe('select 2')
  })
  test('caret right after a semicolon still selects that statement', () => {
    expect(statementAt(stmts, sql.indexOf(';') + 1)?.text).toBe('select 1')
  })
  test('caret on a blank line selects the preceding statement', () => {
    expect(statementAt(stmts, sql.indexOf('\n\n') + 1)?.text).toBe('select 1')
  })
})

describe('findParams', () => {
  test('finds :named params but not PostgreSQL :: casts or params in strings', () => {
    const p = findParams("select :id, x::int, ':nope' from t where a = :id and b = :b2", 'postgres')
    expect(p.map((x) => x.name)).toEqual(['id', 'id', 'b2'])
  })
  test('finds positional params per engine', () => {
    expect(findParams('select $1, $2, $1', 'postgres').map((x) => x.name)).toEqual(['$1', '$2', '$1'])
    expect(findParams("select ?, '?', ?", 'mysql').map((x) => x.name)).toEqual(['?1', '?2'])
    expect(findParams('select ? ->> ?', 'postgres')).toEqual([])
  })
})

describe('bindParams', () => {
  test('rewrites named params to $n for PostgreSQL, reusing numbers', () => {
    expect(bindParams('select :a, :b, :a', 'postgres', { a: 1, b: 'x' })).toEqual({
      sql: 'select $1, $2, $1',
      params: [1, 'x']
    })
  })
  test('keeps native $n params for PostgreSQL', () => {
    expect(bindParams('select $2, $1', 'postgres', { $1: 'a', $2: 'b' })).toEqual({ sql: 'select $2, $1', params: ['a', 'b'] })
  })
  test('rewrites to ? in occurrence order for MySQL/SQLite', () => {
    expect(bindParams('select :a, ?, :a', 'sqlite', { a: 1, '?1': 2 })).toEqual({ sql: 'select ?, ?, ?', params: [1, 2, 1] })
  })
  test('throws when a value is missing', () => {
    expect(() => bindParams('select :a', 'mysql', {})).toThrow(/:a/)
  })
})
