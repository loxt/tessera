// Visual table filter: conditions picked from menus become a WHERE clause the user can read.
// Values go through the same literal() escaping as "Filter by This Value"; LIKE patterns use '!'
// as the escape character, which all three engines accept in an explicit ESCAPE clause.
import { literal, quoteIdent } from './dml'
import type { ColumnMeta, Engine } from './model'

export type ColumnKind = 'text' | 'number' | 'date' | 'bool' | 'other'
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'lastDays'
  | 'isTrue'
  | 'isFalse'
  | 'isNull'
  | 'notNull'

export interface Condition {
  column: string
  op: FilterOp
  value?: string
}

const MAX_DAYS = 100_000

export function columnKind(type: string): ColumnKind {
  if (/^(bool|boolean)\b|^bit\(1\)|^tinyint\(1\)/i.test(type)) return 'bool'
  if (/int|numeric|decimal|float|double|real|serial|money|number/i.test(type)) return 'number'
  if (/date|time/i.test(type)) return 'date'
  if (/char|text|uuid|enum|clob|string|name/i.test(type)) return 'text'
  return 'other'
}

const OPS: Record<ColumnKind, FilterOp[]> = {
  text: ['eq', 'neq', 'contains', 'notContains', 'startsWith', 'isNull', 'notNull'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notNull'],
  date: ['lastDays', 'gt', 'lt', 'eq', 'isNull', 'notNull'],
  bool: ['isTrue', 'isFalse', 'isNull', 'notNull'],
  other: ['eq', 'neq', 'isNull', 'notNull']
}

export const opsFor = (kind: ColumnKind): FilterOp[] => OPS[kind]

export const needsValue = (op: FilterOp): boolean => !['isNull', 'notNull', 'isTrue', 'isFalse'].includes(op)

export function opLabel(op: FilterOp, kind: ColumnKind): string {
  const date = kind === 'date'
  const labels: Record<FilterOp, string> = {
    eq: 'is',
    neq: 'is not',
    contains: 'contains',
    notContains: 'does not contain',
    startsWith: 'starts with',
    gt: date ? 'after' : '>',
    gte: '≥',
    lt: date ? 'before' : '<',
    lte: '≤',
    lastDays: 'in the last',
    isTrue: 'is true',
    isFalse: 'is false',
    isNull: 'is NULL',
    notNull: 'is not NULL'
  }
  return labels[op]
}

function columnOf(cond: Condition, columns: ColumnMeta[]): ColumnMeta {
  const col = columns.find((c) => c.name === cond.column)
  if (!col) throw new Error(`The table has no column "${cond.column}"`)
  return col
}

/** Numbers are emitted as typed (exact numerics stay exact), after checking they are numbers. */
function value(cond: Condition, kind: ColumnKind, engine: Engine): string {
  const v = cond.value ?? ''
  if (!v.trim()) throw new Error(`"${cond.column} ${opLabel(cond.op, kind)}" needs a value`)
  if (kind !== 'number') return literal(v, engine)
  const n = v.trim()
  if (!/^-?\d+(\.\d+)?$/.test(n)) throw new Error(`"${v}" is not a number (column ${cond.column})`)
  return n
}

const likePattern = (v: string) => v.replace(/[!%_]/g, (ch) => `!${ch}`)

function like(col: string, cond: Condition, engine: Engine, negate: boolean, pattern: (v: string) => string): string {
  if (!cond.value?.trim()) throw new Error(`"${cond.column}" needs a value`)
  const op = engine === 'postgres' ? 'ILIKE' : 'LIKE'
  return `${col} ${negate ? 'NOT ' : ''}${op} ${literal(pattern(likePattern(cond.value)), engine)} ESCAPE '!'`
}

function lastDays(col: string, cond: Condition, engine: Engine): string {
  const days = Number(cond.value?.trim())
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`"${cond.value ?? ''}" is not a whole number of days`)
  if (engine === 'postgres') return `${col} >= now() - interval '${days} days'`
  if (engine === 'mysql') return `${col} >= NOW() - INTERVAL ${days} DAY`
  return `${col} >= datetime('now', '-${days} days')`
}

export function buildCondition(cond: Condition, columns: ColumnMeta[], engine: Engine): string {
  const kind = columnKind(columnOf(cond, columns).type)
  const col = quoteIdent(cond.column, engine)
  switch (cond.op) {
    case 'isNull':
      return `${col} IS NULL`
    case 'notNull':
      return `${col} IS NOT NULL`
    case 'isTrue':
      return `${col} = ${literal(true, engine)}`
    case 'isFalse':
      return `${col} = ${literal(false, engine)}`
    case 'contains':
      return like(col, cond, engine, false, (p) => `%${p}%`)
    case 'notContains':
      return like(col, cond, engine, true, (p) => `%${p}%`)
    case 'startsWith':
      return like(col, cond, engine, false, (p) => `${p}%`)
    case 'lastDays':
      return lastDays(col, cond, engine)
    case 'eq':
      return `${col} = ${value(cond, kind, engine)}`
    case 'neq':
      return `${col} <> ${value(cond, kind, engine)}`
    case 'gt':
      return `${col} > ${value(cond, kind, engine)}`
    case 'gte':
      return `${col} >= ${value(cond, kind, engine)}`
    case 'lt':
      return `${col} < ${value(cond, kind, engine)}`
    case 'lte':
      return `${col} <= ${value(cond, kind, engine)}`
  }
}

/** Throws a readable error for the first condition that cannot become SQL. */
export const buildWhere = (conds: Condition[], columns: ColumnMeta[], engine: Engine): string =>
  conds.map((c) => buildCondition(c, columns, engine)).join(' AND ')

export function describeCondition(cond: Condition, columns: ColumnMeta[]): string {
  const kind = columnKind(columns.find((c) => c.name === cond.column)?.type ?? '')
  const head = `${cond.column} ${opLabel(cond.op, kind)}`
  if (!needsValue(cond.op)) return head
  if (cond.op === 'lastDays') return `${head} ${cond.value} days`
  return kind === 'number' ? `${head} ${cond.value}` : `${head} "${cond.value}"`
}
