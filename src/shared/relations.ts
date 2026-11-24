// One table's foreign-key neighbourhood for the relationship diagram: the tables it references
// (parents), the tables that reference it (children), and column-to-column edges.
import type { CompletionMetadata, CompletionTable } from './model'

export interface Edge {
  from: { table: string; column: string }
  to: { table: string; column: string }
}

export interface Neighborhood {
  focus: CompletionTable
  parents: CompletionTable[]
  children: CompletionTable[]
  edges: Edge[]
}

export function neighborhood(md: CompletionMetadata, schema: string, table: string): Neighborhood | null {
  const find = (s: string, n: string) => md.tables.find((t) => t.schema === s && t.name === n)
  const focus = find(schema, table)
  if (!focus) return null
  const parents: CompletionTable[] = []
  const children: CompletionTable[] = []
  const edges: Edge[] = []
  const add = (list: CompletionTable[], t: CompletionTable | undefined) => t && !list.includes(t) && t !== focus && list.push(t)
  for (const fk of md.foreignKeys ?? []) {
    const isChild = fk.schema === schema && fk.table === table
    const isParent = fk.refSchema === schema && fk.refTable === table
    if (!isChild && !isParent) continue
    if (isChild) add(parents, find(fk.refSchema, fk.refTable))
    else add(children, find(fk.schema, fk.table))
    fk.columns.forEach((c, i) => edges.push({ from: { table: fk.table, column: c }, to: { table: fk.refTable, column: fk.refColumns[i] } }))
  }
  // a table on both sides draws once, as a parent
  return { focus, parents, children: children.filter((c) => !parents.includes(c)), edges }
}
