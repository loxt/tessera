import type { ColumnMeta, Engine, TableInfo } from '@shared/model'
import { blank, tableRefs, type TableRef } from '../editor/completion'

/** Constructs after which result rows no longer map 1:1 onto rows of a single table. */
const NOT_ONE_TABLE = /\b(join|union|intersect|except|group\s+by|having|distinct|with|over|lateral|returning)\b|\(\s*select\b/i

/**
 * The table a SELECT reads, when each result row is one row of that table: the same rule
 * DataGrip uses before it lets you edit a console result. Anything else stays read-only.
 */
export function singleTableSource(sql: string, engine: Engine): TableRef | null {
  const text = blank(sql, engine).trim()
  if (!/^select\b/i.test(text) || NOT_ONE_TABLE.test(text)) return null
  const refs = tableRefs(sql, engine)
  // "from a, b" is a join as well
  return refs.length === 1 ? refs[0] : null
}

/**
 * Why a result of `info` can't be edited, or null when it can: every result column must be a
 * real column of the table (no expressions or aliases), names unique, and the primary key present
 * so each UPDATE targets exactly one row.
 */
export function whyReadOnly(columns: ColumnMeta[], info: TableInfo): string | null {
  if (info.kind === 'view') return 'a view'
  if (!info.primaryKey.length) return 'no primary key'
  const names = columns.map((c) => c.name)
  if (new Set(names).size !== names.length) return 'duplicate column names'
  const tableColumns = new Set(info.columns.map((c) => c.name))
  const computed = names.find((n) => !tableColumns.has(n))
  if (computed) return `"${computed}" is not a column of ${info.name}`
  const missingKey = info.primaryKey.find((k) => !names.includes(k))
  if (missingKey) return `primary key ${missingKey} is not in the result`
  return null
}
