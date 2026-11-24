import type { CellValue, CompletionFk, CompletionTable, DbNode, FolderKind, NodeKind, ObjectPath, PlanNode, TableInfo } from '@shared/model'
import type { DbSession } from './types'

export type Row = Record<string, CellValue>

/** Runs a catalog query and returns rows keyed by column name. */
export async function records(s: DbSession, sql: string, params: CellValue[] = []): Promise<Row[]> {
  const out = await s.query(sql, params)
  return out.rows.map((r) => Object.fromEntries(out.columns.map((c, i) => [c.name, r[i]])))
}

export const str = (v: CellValue | undefined): string => (v === null || v === undefined ? '' : String(v))

/** Truthy for driver booleans as well as MySQL/SQLite 1/'1'. */
export const flag = (v: CellValue | undefined): boolean => v === true || v === 1 || v === '1' || v === 't'

/** Groups ordered rows by a key, keeping first-seen order. */
export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it])
  return m
}

export interface CatalogObject {
  kind: Extract<NodeKind, 'table' | 'view' | 'routine' | 'sequence'>
  name: string
  detail?: string
  /** disambiguates overloads; defaults to name */
  idName?: string
}

/** Engine-specific catalog queries; `browse` turns them into explorer nodes. */
export interface Catalog {
  folders: FolderKind[]
  schemas(s: DbSession, showSystem: boolean): Promise<string[]>
  objects(s: DbSession, schema: string, folder: FolderKind, showSystem: boolean): Promise<CatalogObject[]>
  tableInfo(s: DbSession, schema: string, table: string): Promise<TableInfo>
}

const cols = (c: string[]) => `(${c.join(', ')})`

export async function browse(cat: Catalog, s: DbSession, path: ObjectPath | null, showSystem: boolean): Promise<DbNode[]> {
  if (!path?.schema) {
    const names = await cat.schemas(s, showSystem)
    return names.map((name) => ({ id: `schema:${name}`, kind: 'schema', name, path: { schema: name }, hasChildren: true }))
  }
  const schema = path.schema
  if (!path.table && !path.folder) {
    return cat.folders.map((folder) => ({
      id: `folder:${schema}/${folder}`,
      kind: 'folder',
      name: folder,
      path: { schema, folder },
      hasChildren: true
    }))
  }
  if (!path.table && path.folder) {
    const objs = await cat.objects(s, schema, path.folder, showSystem)
    return objs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => {
        const isRelation = o.kind === 'table' || o.kind === 'view'
        return {
          id: `${o.kind}:${schema}/${o.idName ?? o.name}`,
          kind: o.kind,
          name: o.name,
          path: isRelation ? { schema, table: o.name } : { schema },
          hasChildren: isRelation,
          ...(o.detail ? { detail: o.detail } : {})
        }
      })
  }
  const table = path.table!
  const info = await cat.tableInfo(s, schema, table)
  if (!path.folder) {
    const folders: FolderKind[] = info.kind === 'view' ? ['columns'] : ['columns', 'keys', 'fks', 'indexes']
    return folders.map((folder) => ({
      id: `folder:${schema}/${table}/${folder}`,
      kind: 'folder',
      name: folder,
      path: { schema, table, folder },
      hasChildren: true
    }))
  }
  return leafNodes(info, path.folder)
}

function leafNodes(info: TableInfo, folder: FolderKind): DbNode[] {
  const { schema, name: table } = info
  const leaf = (kind: NodeKind, name: string, detail: string): DbNode => ({
    id: `${kind}:${schema}/${table}/${name}`,
    kind,
    name,
    path: { schema, table },
    hasChildren: false,
    detail
  })
  switch (folder) {
    case 'columns':
      return info.columns.map((c) => leaf('column', c.name, c.type + (c.nullable ? '' : ' NOT NULL')))
    case 'keys': {
      const pkIndexed = info.indexes.some((i) => i.primary)
      const pk = info.primaryKey.length && !pkIndexed ? [leaf('key', 'PRIMARY KEY', cols(info.primaryKey))] : []
      return [...pk, ...info.indexes.filter((i) => i.unique).map((i) => leaf('key', i.name, cols(i.columns)))]
    }
    case 'fks':
      return info.foreignKeys.map((f) => leaf('fk', f.name, `${cols(f.columns)} → ${f.refTable}${cols(f.refColumns)}`))
    case 'indexes':
      return info.indexes.map((i) => leaf('index', i.name, cols(i.columns) + (i.unique ? ' UNIQUE' : '')))
    default:
      return []
  }
}

/** Builds a tree from (depth, node) pairs listed in pre-order. */
export function treeFromDepths(items: { depth: number; node: PlanNode }[]): PlanNode[] {
  const roots: PlanNode[] = []
  const stack: { depth: number; node: PlanNode }[] = []
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop()
    ;(stack.length ? stack[stack.length - 1].node.children : roots).push(it.node)
    stack.push(it)
  }
  return roots
}

/** Caps for completion metadata. Tables and columns are capped separately, so a database with
 * many columns still lists every table (late schemas used to vanish behind one per-column cap). */
export const MAX_COMPLETION_TABLES = 20_000
export const MAX_COMPLETION_COLUMNS = 200_000

/**
 * One row per column pair (id, schema, name, ref_schema, ref_name, col, ref_col, pos) → CompletionFk[].
 * A key whose referenced column is unknown (SQLite's implicit "REFERENCES t") is dropped.
 */
export function toCompletionFks(rows: Row[]): CompletionFk[] {
  const out: CompletionFk[] = []
  for (const group of groupBy(rows, (r) => str(r.id)).values()) {
    const pairs = [...group].sort((a, b) => Number(a.pos) - Number(b.pos))
    if (pairs.some((p) => p.ref_col === null || p.ref_col === undefined)) continue
    const head = pairs[0]
    out.push({
      schema: str(head.schema),
      table: str(head.name),
      columns: pairs.map((p) => str(p.col)),
      refSchema: str(head.ref_schema),
      refTable: str(head.ref_name),
      refColumns: pairs.map((p) => str(p.ref_col))
    })
  }
  return out
}

/** Table rows (schema, name, is_view) + column rows (schema, name, col) in column order → CompletionTable[]. */
export function toCompletionTables(tables: Row[], columns: Row[]): CompletionTable[] {
  const key = (r: Row) => `${str(r.schema)}\u0000${str(r.name)}`
  const columnsOf = groupBy(columns, key)
  return tables.map((r) => ({
    schema: str(r.schema),
    name: str(r.name),
    kind: flag(r.is_view) ? 'view' : 'table',
    columns: (columnsOf.get(key(r)) ?? []).map((c) => str(c.col))
  }))
}
