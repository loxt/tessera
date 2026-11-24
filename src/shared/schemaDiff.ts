// Schema diff between two data sources (e.g. staging → production) and the migration that makes the
// target match the source. Indexes and foreign keys match by their columns, since names often differ
// between environments. The migration never drops: what exists only in the target is written commented out.
import { quoteIdent } from './dml'
import type { ColumnInfo, Engine, ForeignKeyInfo, IndexInfo, TableInfo } from './model'

export type ColumnChange = 'type' | 'nullable' | 'default'

export type DiffItem =
  | { kind: 'table-added'; table: string }
  | { kind: 'table-removed'; table: string }
  | { kind: 'column-added'; table: string; column: ColumnInfo }
  | { kind: 'column-removed'; table: string; column: string }
  | { kind: 'column-changed'; table: string; column: string; source: ColumnInfo; target: ColumnInfo; changes: ColumnChange[] }
  | { kind: 'index-added'; table: string; index: IndexInfo }
  | { kind: 'index-removed'; table: string; index: IndexInfo }
  | { kind: 'fk-added'; table: string; fk: ForeignKeyInfo }
  | { kind: 'fk-removed'; table: string; fk: ForeignKeyInfo }
  | { kind: 'pk-changed'; table: string; source: string[]; target: string[] }

const norm = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const indexKey = (i: IndexInfo) => `${i.primary ? 'pk' : i.unique ? 'u' : 'i'}:${i.columns.join(',')}`
const fkKey = (f: ForeignKeyInfo) => `${f.columns.join(',')}>${f.refTable}(${f.refColumns.join(',')})`

function columnChanges(s: ColumnInfo, t: ColumnInfo): ColumnChange[] {
  const out: ColumnChange[] = []
  if (norm(s.type) !== norm(t.type)) out.push('type')
  if (s.nullable !== t.nullable) out.push('nullable')
  if (norm(s.default) !== norm(t.default)) out.push('default')
  return out
}

export function diffSchemas(source: TableInfo[], target: TableInfo[]): DiffItem[] {
  const out: DiffItem[] = []
  const byName = new Map(target.map((t) => [t.name, t]))
  const sourceNames = new Set(source.map((t) => t.name))
  for (const s of source) {
    const t = byName.get(s.name)
    if (!t) {
      out.push({ kind: 'table-added', table: s.name })
      continue
    }
    const tCols = new Map(t.columns.map((c) => [c.name, c]))
    for (const c of s.columns) {
      const tc = tCols.get(c.name)
      if (!tc) out.push({ kind: 'column-added', table: s.name, column: c })
      else {
        const changes = columnChanges(c, tc)
        if (changes.length) out.push({ kind: 'column-changed', table: s.name, column: c.name, source: c, target: tc, changes })
      }
    }
    const sColNames = new Set(s.columns.map((c) => c.name))
    for (const c of t.columns) if (!sColNames.has(c.name)) out.push({ kind: 'column-removed', table: s.name, column: c.name })

    // primary keys compare by their columns: some engines (SQLite) do not list them as indexes
    if (s.primaryKey.join(',') !== t.primaryKey.join(',')) out.push({ kind: 'pk-changed', table: s.name, source: s.primaryKey, target: t.primaryKey })
    const plain = (list: IndexInfo[]) => list.filter((i) => !i.primary)
    const tIdx = new Set(plain(t.indexes).map(indexKey))
    const sIdx = new Set(plain(s.indexes).map(indexKey))
    for (const i of plain(s.indexes)) if (!tIdx.has(indexKey(i))) out.push({ kind: 'index-added', table: s.name, index: i })
    for (const i of plain(t.indexes)) if (!sIdx.has(indexKey(i))) out.push({ kind: 'index-removed', table: s.name, index: i })

    const tFk = new Set(t.foreignKeys.map(fkKey))
    const sFk = new Set(s.foreignKeys.map(fkKey))
    for (const f of s.foreignKeys) if (!tFk.has(fkKey(f))) out.push({ kind: 'fk-added', table: s.name, fk: f })
    for (const f of t.foreignKeys) if (!sFk.has(fkKey(f))) out.push({ kind: 'fk-removed', table: s.name, fk: f })
  }
  for (const t of target) if (!sourceNames.has(t.name)) out.push({ kind: 'table-removed', table: t.name })
  return out
}

/** Bare identifier when it is plain lower case (PostgreSQL/SQLite style), otherwise quoted. */
const ident = (name: string, engine: Engine) => (engine !== 'mysql' && /^[a-z_][a-z0-9_]*$/.test(name) ? name : quoteIdent(name, engine))

/**
 * SQL that brings the target schema in line with the source, in the target's dialect. `createDdl` holds
 * the source's CREATE statements for tables the target lacks. Statements are for review, never auto-run.
 */
export function migrationSql(items: DiffItem[], engine: Engine, targetSchema: string, createDdl: Map<string, string>): string {
  const q = (n: string) => ident(n, engine)
  const t = (table: string) => (engine === 'sqlite' && targetSchema === 'main' ? q(table) : `${q(targetSchema)}.${q(table)}`)
  const colDef = (c: ColumnInfo) => `${q(c.name)} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default !== null ? ` DEFAULT ${c.default}` : ''}`
  const apply: string[] = []
  const dropped: string[] = []

  for (const it of items) {
    switch (it.kind) {
      case 'table-added':
        apply.push(createDdl.get(it.table) ?? `-- create table ${it.table}: copy its DDL from the source`)
        break
      case 'column-added':
        if (!it.column.nullable && it.column.default === null) apply.push(`-- ${it.table}.${it.column.name} is NOT NULL without a default: existing rows need a value first`)
        apply.push(`ALTER TABLE ${t(it.table)} ADD COLUMN ${colDef(it.column)};`)
        break
      case 'column-changed':
        if (engine === 'mysql') apply.push(`ALTER TABLE ${t(it.table)} MODIFY COLUMN ${colDef(it.source)};`)
        else if (engine === 'sqlite') apply.push(`-- SQLite cannot change column ${it.column} in place (${it.changes.join(', ')}); rebuild ${it.table} to apply it`)
        else {
          const col = `ALTER TABLE ${t(it.table)} ALTER COLUMN ${q(it.column)}`
          if (it.changes.includes('type')) apply.push(`${col} TYPE ${it.source.type};`)
          if (it.changes.includes('nullable')) apply.push(`${col} ${it.source.nullable ? 'DROP' : 'SET'} NOT NULL;`)
          if (it.changes.includes('default')) apply.push(it.source.default === null ? `${col} DROP DEFAULT;` : `${col} SET DEFAULT ${it.source.default};`)
        }
        break
      case 'pk-changed':
        apply.push(`-- ${it.table}: primary key (${it.target.join(', ') || 'none'}) should be (${it.source.join(', ') || 'none'}); change it by hand`)
        break
      case 'index-added':
        apply.push(`CREATE ${it.index.unique ? 'UNIQUE ' : ''}INDEX ${q(it.index.name)} ON ${t(it.table)} (${it.index.columns.map(q).join(', ')});`)
        break
      case 'fk-added':
        if (engine === 'sqlite') apply.push(`-- SQLite cannot add foreign key ${it.fk.name} to ${it.table}; rebuild the table to apply it`)
        else apply.push(`ALTER TABLE ${t(it.table)} ADD CONSTRAINT ${q(it.fk.name)} FOREIGN KEY (${it.fk.columns.map(q).join(', ')}) REFERENCES ${t(it.fk.refTable)} (${it.fk.refColumns.map(q).join(', ')});`)
        break
      case 'table-removed':
        dropped.push(`-- DROP TABLE ${t(it.table)};`)
        break
      case 'column-removed':
        dropped.push(`-- ALTER TABLE ${t(it.table)} DROP COLUMN ${q(it.column)};`)
        break
      case 'index-removed':
        dropped.push(engine === 'mysql' ? `-- DROP INDEX ${q(it.index.name)} ON ${t(it.table)};` : `-- DROP INDEX ${engine === 'sqlite' ? q(it.index.name) : `${q(targetSchema)}.${q(it.index.name)}`};`)
        break
      case 'fk-removed':
        dropped.push(engine === 'mysql' ? `-- ALTER TABLE ${t(it.table)} DROP FOREIGN KEY ${q(it.fk.name)};` : `-- ALTER TABLE ${t(it.table)} DROP CONSTRAINT ${q(it.fk.name)};`)
        break
    }
  }
  const parts = ['-- Migration generated by Tessera: review before running.']
  if (apply.length) parts.push('', ...apply)
  if (dropped.length) parts.push('', '-- Only in the target. Uncomment what should really go:', ...dropped)
  if (!apply.length && !dropped.length) parts.push('', '-- The schemas match.')
  return parts.join('\n') + '\n'
}
