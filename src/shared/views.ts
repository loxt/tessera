// Saved table views: a named filter (visual conditions, typed SQL base, ORDER BY) for one table.
import type { Condition, FilterOp } from './filter'

export interface SavedView {
  id: string
  connectionId: string
  schema: string
  table: string
  name: string
  conditions: Condition[]
  /** a typed WHERE the conditions are ANDed to */
  base: string
  orderBy: string
}

const OPS: FilterOp[] = ['eq', 'neq', 'contains', 'notContains', 'startsWith', 'gt', 'gte', 'lt', 'lte', 'lastDays', 'isTrue', 'isFalse', 'isNull', 'notNull']
const MAX_VIEWS = 2000
const MAX_TEXT = 20_000

const str = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max

function condition(c: unknown): Condition | null {
  if (!c || typeof c !== 'object') return null
  const { column, op, value } = c as Record<string, unknown>
  if (!str(column) || !column || !OPS.includes(op as FilterOp)) return null
  if (value !== undefined && !str(value, MAX_TEXT)) return null
  return value === undefined ? { column, op: op as FilterOp } : { column, op: op as FilterOp, value }
}

/** Validates views at the IPC boundary; anything malformed is dropped, not repaired. */
export function sanitizeViews(list: unknown): SavedView[] {
  if (!Array.isArray(list)) return []
  const out: SavedView[] = []
  for (const raw of list) {
    if (out.length >= MAX_VIEWS) break
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (![r.id, r.connectionId, r.schema, r.table].every((x) => str(x) && x)) continue
    if (!str(r.name, 120) || !(r.name as string).trim()) continue
    if (!str(r.base, MAX_TEXT) || !str(r.orderBy, MAX_TEXT) || !Array.isArray(r.conditions) || r.conditions.length > 100) continue
    const conditions = r.conditions.map(condition)
    if (conditions.some((c) => c === null)) continue
    out.push({
      id: r.id as string,
      connectionId: r.connectionId as string,
      schema: r.schema as string,
      table: r.table as string,
      name: (r.name as string).trim(),
      conditions: conditions as Condition[],
      base: r.base as string,
      orderBy: r.orderBy as string
    })
  }
  return out
}

export const viewsFor = (views: SavedView[], connectionId: string, schema: string, table: string): SavedView[] =>
  views.filter((v) => v.connectionId === connectionId && v.schema === schema && v.table === table).sort((a, b) => a.name.localeCompare(b.name))
