import { quoteIdent } from '@shared/dml'
import type { CompletionMetadata, CompletionTable, Engine } from '@shared/model'
import { lex, splitStatements, statementAt } from '@shared/sql'
import { condition, makeAlias, relationsOf, type Scoped } from './joins'

export interface TableRef {
  schema?: string
  table: string
  alias?: string
}

export interface Suggestion {
  label: string
  /** join: a whole "table alias ON …" clause, or an ON condition, built from a foreign key */
  kind: 'column' | 'table' | 'view' | 'schema' | 'keyword' | 'join'
  detail?: string
  insertText: string
  sortText: string
}

/** How often this data source's history used each table and column, recent queries weighing more. */
export interface Usage {
  tables: Map<string, number>
  columns: Map<string, number>
}

const IDENT = '(?:"[^"]+"|`[^`]+`|[A-Za-z_][\\w$]*)'
const ITEM = new RegExp(`^\\s*(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?(?:\\s+(?:as\\s+)?(${IDENT}))?\\s*$`, 'i')
const CLAUSE_END =
  /\b(where|group|order|limit|having|on|using|set|values|join|left|right|inner|full|cross|natural|union|returning|window|offset|fetch|for)\b|[();]/i
const TABLE_CONTEXT = new Set(['from', 'join', 'update', 'into', 'table'])

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'USING', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'AND', 'OR', 'NOT',
  'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'AS', 'DISTINCT', 'COUNT(*)', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'UNION', 'UNION ALL', 'WITH', 'RETURNING', 'DESC', 'ASC', 'NULLS LAST'
]

/** Keywords after which an operand (column, value, table) follows, not another keyword. */
const OPERAND_KEYWORDS = new Set([
  'select', 'where', 'and', 'or', 'on', 'by', 'from', 'join', 'set', 'when', 'then', 'else', 'not', 'in', 'like', 'ilike', 'is', 'as',
  'distinct', 'case', 'having', 'values', 'into', 'update', 'table', 'limit', 'offset', 'between', 'exists', 'returning', 'with',
  'union', 'all', 'any', 'some', 'using', 'delete', 'insert'
])

/** In keyword position, what usually comes next in each clause, most likely first. */
const NEXT_KEYWORDS: Record<string, string[]> = {
  '': ['SELECT', 'WITH', 'INSERT INTO', 'UPDATE', 'DELETE FROM'],
  select: ['FROM', 'AS', 'DISTINCT'],
  from: ['WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'AS', 'ORDER BY', 'GROUP BY', 'LIMIT'],
  join: ['ON', 'AS', 'USING', 'WHERE', 'JOIN', 'LEFT JOIN'],
  where: ['AND', 'OR', 'IS NULL', 'IS NOT NULL', 'IN', 'LIKE', 'BETWEEN', 'NOT', 'ORDER BY', 'GROUP BY', 'LIMIT'],
  group: ['HAVING', 'ORDER BY', 'LIMIT'],
  order: ['DESC', 'ASC', 'LIMIT', 'OFFSET', 'NULLS LAST'],
  limit: ['OFFSET'],
  set: ['WHERE']
}
const STATEMENT_STARTERS = new Set(['INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE'])
const CLAUSE = /\b(select|from|join|on|where|having|group\s+by|order\s+by|limit|set)\b/gi
const clauseOf = (word: string) => {
  const w = word.toLowerCase().split(/\s+/)[0]
  return w === 'on' || w === 'having' ? 'where' : w
}

const HALF_LIFE_MS = 14 * 86_400_000
const KEYWORD_WORDS = new Set(KEYWORDS.flatMap((k) => k.toLowerCase().split(/\W+/)).filter(Boolean))

const unquote = (s: string) => s.replace(/^["`]|["`]$/g, '')

/** Replaces strings and comments with spaces, keeping offsets. */
export function blank(sql: string, engine: Engine): string {
  return lex(sql, engine)
    .map((t) => (t.type === 'code' || t.type === 'ident' ? sql.slice(t.start, t.end) : ' '.repeat(t.end - t.start)))
    .join('')
}

/** Bare identifier when safe, otherwise properly escaped (names come from the database and are untrusted). */
export function quoteIfNeeded(name: string, engine: Engine): string {
  const bare = engine === 'postgres' ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][\w$]*$/
  return bare.test(name) ? name : quoteIdent(name, engine)
}

/** Tables referenced by FROM (incl. comma lists), JOIN, UPDATE and INTO, with aliases. */
export function tableRefs(sql: string, engine: Engine = 'postgres'): TableRef[] {
  const text = blank(sql, engine)
  const out: TableRef[] = []
  for (const m of text.matchAll(/\b(from|join|update|into)\b/gi)) {
    let rest = text.slice(m.index + m[0].length)
    const end = rest.search(CLAUSE_END)
    if (end >= 0) rest = rest.slice(0, end)
    for (const item of m[1].toLowerCase() === 'from' ? rest.split(',') : [rest]) {
      const im = ITEM.exec(item)
      if (!im) continue
      const ref: TableRef = im[2] ? { schema: unquote(im[1]), table: unquote(im[2]) } : { table: unquote(im[1]) }
      if (im[3]) ref.alias = unquote(im[3])
      out.push(ref)
    }
  }
  return out
}

function resolveTable(md: CompletionMetadata, ref: TableRef): CompletionTable | undefined {
  const name = ref.table.toLowerCase()
  const candidates = md.tables.filter(
    (t) => t.name.toLowerCase() === name && (!ref.schema || t.schema.toLowerCase() === ref.schema.toLowerCase())
  )
  return candidates.find((t) => t.schema === md.defaultSchema) ?? candidates[0]
}

/** Tables and columns used by successful queries, each query counted once and halving every two weeks. */
export function computeUsage(entries: { sql: string; at: number; ok: boolean }[], engine: Engine, now: number): Usage {
  const usage: Usage = { tables: new Map(), columns: new Map() }
  const add = (map: Map<string, number>, key: string, w: number) => map.set(key, (map.get(key) ?? 0) + w)
  for (const e of entries) {
    if (!e.ok) continue
    const w = 0.5 ** (Math.max(0, now - e.at) / HALF_LIFE_MS)
    for (const t of new Set(tableRefs(e.sql, engine).map((r) => r.table.toLowerCase()))) add(usage.tables, t, w)
    const words = new Set<string>()
    for (const tok of lex(e.sql, engine)) {
      const text = e.sql.slice(tok.start, tok.end)
      if (tok.type === 'ident') words.add(unquote(text).toLowerCase())
      else if (tok.type === 'code') for (const m of text.matchAll(/[A-Za-z_][\w$]*/g)) words.add(m[0].toLowerCase())
    }
    for (const word of words) if (!KEYWORD_WORDS.has(word)) add(usage.columns, word, w)
  }
  return usage
}

/** Higher usage sorts first; a fixed width keeps string comparison numeric. */
const rank = (score = 0) => String(999_999 - Math.min(999_999, Math.round(score * 1000))).padStart(6, '0')

/** Writes keywords the way the user writes them: all lower case when the sample is lower case. */
const caseLike = (keyword: string, sample: string) => (/[a-z]/.test(sample) && sample === sample.toLowerCase() ? keyword.toLowerCase() : keyword)

/**
 * True where SQL expects a keyword rather than an operand: after a complete item such as
 * `select *`, `select id`, `from orders o` or `where id = 1`, or at the start of a statement.
 */
function atKeywordPosition(rest: string): boolean {
  if (!rest.trim()) return true
  if (!/\s$/.test(rest)) return false
  const prev = /([\w$]+|[^\s\w])\s*$/.exec(rest)?.[1] ?? ''
  if (/^[\w$]+$/.test(prev)) return !OPERAND_KEYWORDS.has(prev.toLowerCase())
  return prev === '*' || prev === ')' || prev === '"' || prev === '`'
}

/** Context-aware completion for the statement under `offset`. */
export function suggest(text: string, offset: number, md: CompletionMetadata, engine: Engine, usage?: Usage): Suggestion[] {
  const st = statementAt(splitStatements(text, engine), offset)
  const start = st && st.start <= offset ? st.start : 0
  const stmtText = text.slice(start, Math.max(st?.end ?? 0, offset))
  const before = blank(text.slice(start, offset), engine)
  const word = /[\w$]*$/.exec(before)?.[0] ?? ''
  const rest = before.slice(0, before.length - word.length)
  const refs = tableRefs(stmtText, engine).filter((r) => !word || r.table.toLowerCase() !== word.toLowerCase() || !!r.alias)
  const q = (n: string) => quoteIfNeeded(n, engine)
  const tableScore = (t: CompletionTable) => usage?.tables.get(t.name.toLowerCase())
  const sample = word || ([...rest.matchAll(CLAUSE)].pop()?.[0] ?? '')

  const columnItems = (t: CompletionTable, sort: string): Suggestion[] =>
    // most used first, then the table's own column order
    t.columns.map((c, i) => ({
      label: c,
      kind: 'column',
      detail: t.name,
      insertText: q(c),
      sortText: sort + rank(usage?.columns.get(c.toLowerCase())) + String(i).padStart(4, '0')
    }))
  const tableItem = (t: CompletionTable, qualify: boolean, sort: string): Suggestion => {
    const label = qualify ? `${t.schema}.${t.name}` : t.name
    const insertText = qualify ? `${q(t.schema)}.${q(t.name)}` : q(t.name)
    return { label, kind: t.kind, detail: t.schema, insertText, sortText: sort + (qualify ? '1' : '0') + rank(tableScore(t)) + label }
  }
  const keywordItems = (priority: string[]): Suggestion[] =>
    [...new Set([...priority, ...KEYWORDS])].map((k) => {
      const i = priority.indexOf(k)
      return { label: k, kind: 'keyword', insertText: caseLike(k, sample), sortText: i >= 0 ? `0${String(i).padStart(2, '0')}` : `5${k}` }
    })

  const qualifier = /("[^"]+"|`[^`]+`|[A-Za-z_][\w$]*)\.[\w$]*$/.exec(before)
  if (qualifier) {
    const name = unquote(qualifier[1]).toLowerCase()
    const ref = refs.find((r) => r.alias?.toLowerCase() === name) ?? refs.find((r) => r.table.toLowerCase() === name)
    const schema = md.schemas.find((s) => s.toLowerCase() === name)
    // `supplier.` is the schema, unless the statement references a table (or alias) by that name
    if (schema && !ref) return md.tables.filter((t) => t.schema === schema).map((t) => tableItem(t, false, '1'))
    const table = resolveTable(md, ref ?? { table: name })
    return table ? columnItems(table, '0') : []
  }

  const scoped: Scoped[] = refs.flatMap((r) => {
    const table = resolveTable(md, r)
    return table ? [{ table, alias: r.alias ?? q(table.name) }] : []
  })
  const prevWord = /([A-Za-z_]+)\s+$/.exec(rest)?.[1]?.toLowerCase()
  const tables = md.tables.map((t) => tableItem(t, t.schema !== md.defaultSchema, '2'))
  const schemas: Suggestion[] = md.schemas
    .filter((s) => s !== md.defaultSchema)
    .map((s) => ({ label: s, kind: 'schema', insertText: q(s), sortText: '3' + s }))

  if (prevWord === 'join') return [...joinItems(scoped, md, rest, q), ...relatedTables(scoped, md, tables), ...schemas]
  if (prevWord && TABLE_CONTEXT.has(prevWord)) return [...tables, ...schemas]
  if (atKeywordPosition(rest)) {
    const clauses = [...rest.matchAll(CLAUSE)]
    const items = keywordItems(NEXT_KEYWORDS[clauses.length ? clauseOf(clauses[clauses.length - 1][1]) : ''] ?? [])
    // statement starters (DELETE FROM, CREATE TABLE…) only make sense at the start of a statement
    return rest.trim() ? items.filter((k) => !STATEMENT_STARTERS.has(k.label)) : items
  }

  const seen = new Set<string>()
  const columns = scoped.flatMap((s) => columnItems(s.table, '1')).filter((s) => !seen.has(s.label) && !!seen.add(s.label))
  const conditions = prevWord === 'on' ? onConditions(scoped, md, rest, q) : []
  return [...conditions, ...columns, ...tables, ...schemas, ...keywordItems([])]
}

/** "customers c on c.id = o.customer_id" for every table related by a foreign key to the statement's tables. */
function joinItems(scoped: Scoped[], md: CompletionMetadata, rest: string, q: (n: string) => string): Suggestion[] {
  const joinWord = /(join)\s+$/i.exec(rest)?.[1] ?? 'join'
  const [on, and] = joinWord === joinWord.toUpperCase() ? ['ON', 'AND'] : ['on', 'and']
  const taken = new Set(scoped.flatMap((s) => [s.alias.toLowerCase(), s.table.name.toLowerCase()]))
  const seen = new Set<string>()
  return relationsOf(scoped, md).flatMap((r) => {
    const alias = makeAlias(r.other.name, taken)
    const name = r.other.schema === md.defaultSchema ? q(r.other.name) : `${q(r.other.schema)}.${q(r.other.name)}`
    const insertText = `${name} ${alias} ${on} ${condition(r, alias, and, q)}`
    if (seen.has(insertText)) return []
    seen.add(insertText)
    return [{ label: insertText, kind: 'join' as const, detail: `FK ${r.label}`, insertText, sortText: '0' + insertText }]
  })
}

/** Tables related by a foreign key list right after the ready-made joins, before all other tables. */
function relatedTables(scoped: Scoped[], md: CompletionMetadata, tables: Suggestion[]): Suggestion[] {
  const related = new Set(relationsOf(scoped, md).map((r) => `${r.other.schema}.${r.other.name}`))
  return tables.map((t, i) => {
    const table = md.tables[i]
    return related.has(`${table.schema}.${table.name}`) ? { ...t, sortText: '1' + t.sortText.slice(1) } : t
  })
}

/** After `JOIN t x ON`, the foreign-key condition between t and the tables already in the statement. */
function onConditions(scoped: Scoped[], md: CompletionMetadata, rest: string, q: (n: string) => string): Suggestion[] {
  const last = tableRefs(rest).pop()
  const name = (last?.alias ?? last?.table ?? '').toLowerCase()
  const joined = scoped.find((s) => s.alias.toLowerCase() === name)
  if (!joined) return []
  const and = /\bon\s+$/.test(rest) ? 'and' : 'AND'
  const others = scoped.filter((s) => s !== joined)
  return relationsOf(others, md)
    .filter((r) => r.other === joined.table)
    .map((r) => {
      const text = condition(r, joined.alias, and, q)
      return { label: text, kind: 'join' as const, detail: `FK ${r.label}`, insertText: text, sortText: '00' + text }
    })
}
