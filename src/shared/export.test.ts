import { describe, expect, test } from 'vitest'
import { countSql, createExporter, EXPORT_FORMATS, exportResult, pagedSql, sortedSql, withExportExtension } from './export'
import type { ResultSet } from './model'

const rs: ResultSet = {
  columns: [
    { name: 'id', type: 'int4' },
    { name: 'note', type: 'text' },
    { name: 'blob', type: 'bytea' }
  ],
  rows: [
    [1, 'plain', null],
    [2, 'has "quote", comma\nnewline', { $t: 'binary', hex: '00ff', size: 2 }]
  ],
  hasMore: false
}

describe('exportResult', () => {
  test('CSV quotes only when needed and writes NULL as empty', () => {
    expect(exportResult(rs, 'csv')).toBe('id,note,blob\n1,plain,\n2,"has ""quote"", comma\nnewline",0x00ff\n')
  })
  test('TSV', () => {
    expect(exportResult({ ...rs, rows: [rs.rows[0]] }, 'tsv')).toBe('id\tnote\tblob\n1\tplain\t\n')
  })
  test('JSON keeps nulls and types', () => {
    expect(JSON.parse(exportResult(rs, 'json'))[0]).toEqual({ id: 1, note: 'plain', blob: null })
  })
  test('JSONL writes one compact object per line', () => {
    expect(exportResult(rs, 'jsonl')).toBe(
      '{"id":1,"note":"plain","blob":null}\n{"id":2,"note":"has \\"quote\\", comma\\nnewline","blob":"0x00ff"}\n'
    )
  })
  test('SQL INSERT statements use the target dialect', () => {
    expect(exportResult({ ...rs, rows: [rs.rows[0]] }, 'sql', { table: 'notes', engine: 'mysql' })).toBe(
      "INSERT INTO `notes` (`id`, `note`, `blob`) VALUES (1, 'plain', NULL);\n"
    )
  })
  test('Markdown escapes pipes', () => {
    const md = exportResult({ columns: [{ name: 'a|b', type: 'text' }], rows: [['x|y']], hasMore: false }, 'markdown')
    expect(md).toBe('| a\\|b |\n| --- |\n| x\\|y |\n')
  })
})

describe('createExporter', () => {
  const empty: ResultSet = { ...rs, rows: [] }
  test.each(EXPORT_FORMATS.map((f) => f.id))('%s written batch by batch matches the one-shot export', (format) => {
    for (const set of [rs, empty]) {
      const ex = createExporter(set.columns, format, { table: 't' })
      const streamed = ex.head() + set.rows.map((r) => ex.rows([r])).join('') + ex.rows([]) + ex.tail()
      expect(streamed).toBe(exportResult(set, format, { table: 't' }))
    }
  })
})

describe('sortedSql', () => {
  test('wraps a query to apply the grid sort server-side', () => {
    expect(sortedSql('SELECT a, b FROM t -- note\n;', 'postgres', 1, 'desc', ['a', 'b'])).toBe('SELECT * FROM (\nSELECT a, b FROM t -- note\n) tessera_export ORDER BY 2 DESC')
  })
  test('leaves statements that cannot be a subquery alone', () => {
    expect(sortedSql('SHOW TABLES', 'mysql', 0, 'asc', ['Tables'])).toBe('SHOW TABLES')
  })
  test('does not wrap a result with duplicate column names (MySQL rejects such derived tables)', () => {
    expect(sortedSql('SELECT a.id, b.id FROM a JOIN b', 'mysql', 0, 'asc', ['id', 'id'])).toBe('SELECT a.id, b.id FROM a JOIN b')
  })
})

describe('pagedSql', () => {
  test('wraps a query to read one page, one row past it so the fetch limit can tell there is more', () => {
    expect(pagedSql('select * from t order by id;', 'postgres', 20, 10, ['id'])).toBe('SELECT * FROM (\nselect * from t order by id\n) tessera_page LIMIT 11 OFFSET 20')
  })
  test('is null where paging cannot be done by wrapping', () => {
    expect(pagedSql('SHOW TABLES', 'mysql', 10, 10, ['Tables'])).toBeNull()
    expect(pagedSql('SELECT a.id, b.id FROM a JOIN b', 'mysql', 10, 10, ['id', 'id'])).toBeNull()
  })
})

describe('countSql', () => {
  test('counts a query as a subquery', () => {
    expect(countSql('select * from t;', 'sqlite')).toBe('SELECT count(*) FROM (\nselect * from t\n) tessera_count')
  })
  test('is null for statements that cannot be a subquery', () => {
    expect(countSql('PRAGMA table_info(t)', 'sqlite')).toBeNull()
  })
})

describe('withExportExtension', () => {
  test('swaps a known export extension for the new format', () => {
    expect(withExportExtension('/tmp/result.csv', 'json')).toBe('/tmp/result.json')
    expect(withExportExtension('~/out/data.MD', 'csv')).toBe('~/out/data.csv')
  })

  test('leaves paths without a known export extension alone', () => {
    expect(withExportExtension('/tmp/result', 'json')).toBe('/tmp/result')
    expect(withExportExtension('/tmp/archive.tar', 'json')).toBe('/tmp/archive.tar')
    expect(withExportExtension('', 'json')).toBe('')
  })
})
