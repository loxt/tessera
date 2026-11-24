// Foreign-key aware JOIN completion: a table joined to the statement's tables comes with its ON
// clause written, like DataGrip's "join ... on" completion.
import type { CompletionMetadata, CompletionTable } from '@shared/model'

/** A table of the statement and the name it goes by (its alias, or its own name). */
export interface Scoped {
  table: CompletionTable
  alias: string
}

/** A foreign key between a scoped table and `other`, as (scoped column, other column) pairs. */
export interface Relation {
  scoped: Scoped
  other: CompletionTable
  pairs: [string, string][]
  /** "orders.customer_id → customers.id" */
  label: string
}

const same = (t: CompletionTable, schema: string, name: string) => t.schema === schema && t.name === name

/** customers → c, order_items → oi; numbered (o2) when the statement already uses it. */
export function makeAlias(name: string, taken: Set<string>): string {
  const base =
    name
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 't'
  let alias = base
  for (let n = 2; taken.has(alias); n++) alias = `${base}${n}`
  return alias
}

/** Every foreign key touching a scoped table, in both directions (child → parent and parent ← child). */
export function relationsOf(scoped: Scoped[], md: CompletionMetadata): Relation[] {
  const find = (schema: string, name: string) => md.tables.find((t) => same(t, schema, name))
  const out: Relation[] = []
  for (const s of scoped) {
    for (const fk of md.foreignKeys ?? []) {
      const label = `${fk.table}.${fk.columns.join(', ')} → ${fk.refTable}.${fk.refColumns.join(', ')}`
      if (same(s.table, fk.schema, fk.table)) {
        const other = find(fk.refSchema, fk.refTable)
        if (other) out.push({ scoped: s, other, pairs: fk.columns.map((c, i) => [c, fk.refColumns[i]]), label })
      }
      if (same(s.table, fk.refSchema, fk.refTable)) {
        const other = find(fk.schema, fk.table)
        if (other) out.push({ scoped: s, other, pairs: fk.refColumns.map((c, i) => [c, fk.columns[i]]), label })
      }
    }
  }
  return out
}

/** "c.id = o.customer_id", ANDed for composite keys. */
export const condition = (r: Relation, otherAlias: string, and: string, quote: (n: string) => string): string =>
  r.pairs.map(([mine, theirs]) => `${otherAlias}.${quote(theirs)} = ${r.scoped.alias}.${quote(mine)}`).join(` ${and} `)
