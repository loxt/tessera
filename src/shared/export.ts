import { literal, quoteIdent } from './dml'
import { leadingKeyword } from './sql'
import type { CellValue, ColumnMeta, Engine, ResultSet } from './model'

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'jsonl' | 'sql' | 'markdown'

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string }[] = [
  { id: 'csv', label: 'CSV', ext: 'csv' },
  { id: 'tsv', label: 'TSV', ext: 'tsv' },
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'jsonl', label: 'JSON Lines', ext: 'jsonl' },
  { id: 'sql', label: 'SQL INSERT statements', ext: 'sql' },
  { id: 'markdown', label: 'Markdown table', ext: 'md' }
]

const KNOWN_EXTENSIONS = new Set(EXPORT_FORMATS.map((f) => f.ext))

/** `/tmp/result.csv` → `/tmp/result.json` when switching format; other paths are the user's choice and stay. */
export function withExportExtension(path: string, ext: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path)
  return m && KNOWN_EXTENSIONS.has(m[1].toLowerCase()) ? `${path.slice(0, m.index)}.${ext}` : path
}

export interface ExportOptions {
  table?: string
  engine?: Engine
}

export function cellText(v: CellValue): string {
  if (v === null) return ''
  if (typeof v === 'object') return '0x' + v.hex
  return String(v)
}

/** the results grid's quick filter: some cell contains `needle` (already lower-cased) */
export const rowMatches = (row: CellValue[], needle: string) => row.some((v) => cellText(v).toLowerCase().includes(needle))

const SUBQUERY_SAFE = new Set(['SELECT', 'WITH'])

/**
 * The results grid sorts client-side; a full re-run applies that sort in SQL instead. Statements that can't be a
 * subquery (SHOW, PRAGMA, …), or whose columns repeat a name (MySQL rejects that derived table), keep their own order.
 * ponytail: NULL placement follows the database, not the grid (nulls last); add NULLS LAST per engine if it matters.
 */
export function sortedSql(sql: string, engine: Engine, col: number, dir: 'asc' | 'desc', columns: string[]): string {
  if (!SUBQUERY_SAFE.has(leadingKeyword(sql, engine)) || new Set(columns).size !== columns.length) return sql
  return `SELECT * FROM ${subquery(sql, 'tessera_export')} ORDER BY ${col + 1} ${dir.toUpperCase()}`
}

/** count(*) of a statement's rows, for export progress; null when it can't be a subquery */
export function countSql(sql: string, engine: Engine): string | null {
  return SUBQUERY_SAFE.has(leadingKeyword(sql, engine)) ? `SELECT count(*) FROM ${subquery(sql, 'tessera_count')}` : null
}

/**
 * One page of a console result: the statement as a subquery with LIMIT/OFFSET. It asks for one row past
 * the page, so the fetch limit (the page size) reports whether more rows follow. Null when it can't be
 * a subquery, for the same reasons as sortedSql.
 */
export function pagedSql(sql: string, engine: Engine, offset: number, size: number, columns: string[]): string | null {
  if (!SUBQUERY_SAFE.has(leadingKeyword(sql, engine)) || new Set(columns).size !== columns.length) return null
  return `SELECT * FROM ${subquery(sql, 'tessera_page')} LIMIT ${Math.trunc(size) + 1} OFFSET ${Math.max(0, Math.trunc(offset))}`
}

// own lines, so a trailing -- comment can't swallow the closing parenthesis
const subquery = (sql: string, alias: string) => `(\n${sql.replace(/[\s;]+$/, '')}\n) ${alias}`

const csvField =(s: string) => (/[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)
const tsvField = (s: string) => s.replace(/[\t\r\n]/g, ' ')
const mdField = (s: string) => s.replaceAll('|', '\\|').replace(/\r?\n/g, ' ')

/** Serializes a result in pieces, so a large export can be written batch by batch: head() + rows()… + tail(). */
export function createExporter(columns: ColumnMeta[], format: ExportFormat, opts: ExportOptions = {}) {
  const names = columns.map((c) => c.name)
  const object = (r: CellValue[]) => Object.fromEntries(names.map((n, i) => [n, typeof r[i] === 'object' && r[i] !== null ? cellText(r[i]) : r[i]]))
  const line = (cells: string[], field: (s: string) => string, sep: string) => cells.map(field).join(sep) + '\n'
  const mdRow = (cells: string[]) => `| ${cells.map(mdField).join(' | ')} |\n`
  const engine = opts.engine ?? 'postgres'
  const insert = `INSERT INTO ${quoteIdent(opts.table ?? 'my_table', engine)} (${names.map((n) => quoteIdent(n, engine)).join(', ')}) VALUES (`
  let count = 0

  const row = (r: CellValue[]): string => {
    switch (format) {
      case 'csv':
        return line(r.map(cellText), csvField, ',')
      case 'tsv':
        return line(r.map(cellText), tsvField, '\t')
      case 'json':
        // same bytes as JSON.stringify(rows, null, 2)
        return (count ? ',\n' : '[\n') + JSON.stringify(object(r), null, 2).replace(/^/gm, '  ')
      case 'jsonl':
        return JSON.stringify(object(r)) + '\n'
      case 'sql':
        return insert + r.map((v) => literal(v, engine)).join(', ') + ');\n'
      case 'markdown':
        return mdRow(r.map(cellText))
    }
  }

  return {
    head(): string {
      if (format === 'csv') return line(names, csvField, ',')
      if (format === 'tsv') return line(names, tsvField, '\t')
      if (format === 'markdown') return mdRow(names) + `| ${names.map(() => '---').join(' | ')} |\n`
      return ''
    },
    rows(rows: CellValue[][]): string {
      let out = ''
      for (const r of rows) {
        out += row(r)
        count++
      }
      return out
    },
    tail(): string {
      if (format !== 'json') return ''
      return count ? '\n]' : '[]'
    }
  }
}

export function exportResult(rs: ResultSet, format: ExportFormat, opts: ExportOptions = {}): string {
  const ex = createExporter(rs.columns, format, opts)
  return ex.head() + ex.rows(rs.rows) + ex.tail()
}
