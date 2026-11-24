import type { CellValue, Engine } from './model'
import { lex } from './sql'

/** Pending grid edits for one table. Keys are the values of `keyColumns` for a row. */
export interface ChangeSet {
  schema: string
  table: string
  keyColumns: string[]
  updates: { key: CellValue[]; set: Record<string, CellValue> }[]
  inserts: Record<string, CellValue>[]
  deletes: CellValue[][]
}

export interface DmlStatement {
  sql: string
  params: CellValue[]
  /** UPDATE/DELETE must touch exactly one row, otherwise the batch is rolled back */
  expectOne: boolean
}

export function quoteIdent(name: string, engine: Engine): string {
  return engine === 'mysql' ? '`' + name.replaceAll('`', '``') + '`' : '"' + name.replaceAll('"', '""') + '"'
}

export const qualified = (schema: string, table: string, engine: Engine) =>
  `${quoteIdent(schema, engine)}.${quoteIdent(table, engine)}`

export function literal(v: CellValue, engine: Engine): string {
  if (v === null) return 'NULL'
  if (typeof v === 'boolean') return engine === 'postgres' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') return engine === 'postgres' ? `'\\x${v.hex}'::bytea` : `X'${v.hex}'`
  const escaped = v.replaceAll("'", "''")
  if (engine === 'mysql') return `'${escaped.replaceAll('\\', '\\\\')}'`
  // E'' is correct whatever standard_conforming_strings is set to
  if (engine === 'postgres' && v.includes('\\')) return `E'${escaped.replaceAll('\\', '\\\\')}'`
  return `'${escaped}'`
}

export function generateDml(cs: ChangeSet, engine: Engine): DmlStatement[] {
  if ((cs.updates.length || cs.deletes.length) && cs.keyColumns.length === 0) {
    throw new Error(`Table ${cs.table} has no primary key; rows cannot be identified for UPDATE/DELETE`)
  }
  const target = qualified(cs.schema, cs.table, engine)
  const q = (c: string) => quoteIdent(c, engine)
  const out: DmlStatement[] = []

  const build = (head: string, assignments: [string, CellValue][], key: CellValue[] | null, expectOne: boolean) => {
    const params: CellValue[] = []
    const ph = (v: CellValue) => {
      params.push(v)
      return engine === 'postgres' ? `$${params.length}` : '?'
    }
    let sql = head
    if (assignments.length) sql += ' SET ' + assignments.map(([c, v]) => `${q(c)} = ${ph(v)}`).join(', ')
    if (key) {
      sql +=
        ' WHERE ' +
        cs.keyColumns.map((c, i) => (key[i] === null ? `${q(c)} IS NULL` : `${q(c)} = ${ph(key[i])}`)).join(' AND ')
    }
    out.push({ sql, params, expectOne })
  }

  for (const u of cs.updates) build(`UPDATE ${target}`, Object.entries(u.set), u.key, true)
  for (const key of cs.deletes) build(`DELETE FROM ${target}`, [], key, true)
  for (const row of cs.inserts) {
    const cols = Object.keys(row)
    if (cols.length === 0) {
      out.push({ sql: engine === 'mysql' ? `INSERT INTO ${target} () VALUES ()` : `INSERT INTO ${target} DEFAULT VALUES`, params: [], expectOne: false })
      continue
    }
    const marks = cols.map((_, i) => (engine === 'postgres' ? `$${i + 1}` : '?'))
    out.push({ sql: `INSERT INTO ${target} (${cols.map(q).join(', ')}) VALUES (${marks.join(', ')})`, params: cols.map((c) => row[c]), expectOne: false })
  }
  return out
}

/** Human-readable rendering of a parameterized statement (preview only — never executed). */
export function inlineParams(sql: string, params: CellValue[], engine: Engine): string {
  let next = 0
  return lex(sql, engine)
    .map((t) => {
      const text = sql.slice(t.start, t.end)
      if (t.type !== 'code') return text
      return engine === 'postgres'
        ? text.replace(/\$(\d+)/g, (m, n) => (Number(n) <= params.length ? literal(params[Number(n) - 1], engine) : m))
        : text.replace(/\?/g, () => literal(params[next++] ?? null, engine))
    })
    .join('')
}
