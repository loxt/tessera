// Spreadsheet import: parse CSV/TSV, match file columns to table columns, and turn rows into inserts
// with the problems found before anything is written (missing required values, unmapped columns).
import type { CellValue, ColumnInfo } from './model'

export type ImportCell = string | number | boolean | null

const DELIMITERS = [',', ';', '\t', '|']

/** RFC 4180-style: quoted fields may hold separators, "" quotes and line breaks. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ''))
}

/** The separator that splits the first lines into the same number (above one) of fields. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 10)
  let best = { d: ',', score: 0 }
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => parseDelimited(l, d)[0]?.length ?? 0)
    const consistent = counts.length > 0 && counts.every((c) => c === counts[0]) ? counts[0] : 0
    if (consistent > 1 && consistent > best.score) best = { d, score: consistent }
  }
  return best.d
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** table column → index of the file column with the same normalized name, or null */
export function autoMap(headers: string[], columns: ColumnInfo[]): Record<string, number | null> {
  const byName = new Map(headers.map((h, i) => [norm(h), i]))
  return Object.fromEntries(columns.map((c) => [c.name, byName.get(norm(c.name)) ?? null]))
}

const MAX_PROBLEMS = 8

/** A required column: NOT NULL with neither a default nor an auto-increment. */
const required = (c: ColumnInfo) => !c.nullable && c.default === null && !c.autoIncrement

export function buildInserts(rows: ImportCell[][], mapping: Record<string, number | null>, columns: ColumnInfo[], emptyAsNull: boolean) {
  const problems: string[] = []
  for (const c of columns) if (required(c) && mapping[c.name] == null) problems.push(`${c.name} is required and has no source column`)
  const mapped = columns.filter((c) => mapping[c.name] != null)
  const inserts: Record<string, CellValue>[] = []
  rows.forEach((row, r) => {
    const values: Record<string, CellValue> = {}
    for (const c of mapped) {
      const raw = row[mapping[c.name]!] ?? null
      const v = emptyAsNull && (raw === '' || raw === null) ? null : raw
      if (v === null && required(c) && problems.length < MAX_PROBLEMS) problems.push(`Row ${r + 1}: ${c.name} is required`)
      values[c.name] = v
    }
    inserts.push(values)
  })
  return { inserts, problems }
}
