import type { CellValue, Engine } from './model'

type TokenType = 'code' | 'string' | 'ident' | 'comment'
interface Token {
  type: TokenType
  start: number
  end: number
}

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c)

/** Splits SQL into code / string / quoted identifier / comment regions for a dialect. */
export function lex(sql: string, engine: Engine): Token[] {
  const tokens: Token[] = []
  const n = sql.length
  let codeStart = 0
  let i = 0
  const push = (type: TokenType, start: number, end: number) => {
    if (codeStart < start) tokens.push({ type: 'code', start: codeStart, end: start })
    tokens.push({ type, start, end })
    codeStart = end
    i = end
  }
  const until = (from: number, needle: string) => {
    const j = sql.indexOf(needle, from)
    return j < 0 ? n : j + needle.length
  }
  const quoted = (from: number, q: string, backslash: boolean) => {
    let j = from + 1
    while (j < n) {
      const c = sql[j]
      if (backslash && c === '\\') j += 2
      else if (c === q && sql[j + 1] === q) j += 2
      else if (c === q) return j + 1
      else j++
    }
    return n
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    const lineEnd = () => (sql.indexOf('\n', i) < 0 ? n : sql.indexOf('\n', i))
    // MySQL only treats "-- " (dash dash + whitespace) as a comment; "5--1" is arithmetic
    if (c === '-' && next === '-' && (engine !== 'mysql' || i + 2 >= n || /\s/.test(sql[i + 2]))) push('comment', i, lineEnd())
    else if (c === '#' && engine === 'mysql') push('comment', i, lineEnd())
    else if (c === '/' && next === '*') push('comment', i, until(i + 2, '*/'))
    else if (c === "'") {
      const eString = engine === 'postgres' && /[eE]/.test(sql[i - 1] ?? '') && !isWordChar(sql[i - 2])
      push('string', i, quoted(i, "'", engine === 'mysql' || eString))
    } else if (c === '"') push(engine === 'mysql' ? 'string' : 'ident', i, quoted(i, '"', engine === 'mysql'))
    else if (c === '`' && engine !== 'postgres') push('ident', i, quoted(i, '`', false))
    else if (c === '[' && engine === 'sqlite') push('ident', i, until(i, ']'))
    else if (c === '$' && engine === 'postgres' && !isWordChar(sql[i - 1])) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))
      if (m) push('string', i, until(i + m[0].length, m[0]))
      else i++
    } else i++
  }
  if (codeStart < n) tokens.push({ type: 'code', start: codeStart, end: n })
  return tokens
}

export interface Statement {
  text: string
  /** offsets of `text` in the source */
  start: number
  end: number
  /** offset just past the statement delimiter (or `end` when there is none) */
  endWithDelimiter: number
}

/** CREATE … TRIGGER/PROCEDURE/FUNCTION/EVENT, allowing any modifiers (OR REPLACE, DEFINER=`u`@`h`, TEMP) before the keyword. */
const BLOCK_STATEMENT = /^\s*create\s+(?:[^(;]*?\s)?(trigger|procedure|function|event)\b/i
const UNCOUNTED_END = new Set(['IF', 'LOOP', 'WHILE', 'REPEAT'])

/**
 * Dialect-aware statement splitter: honours strings, quoted identifiers, comments,
 * PostgreSQL dollar quotes, MySQL DELIMITER and BEGIN…END bodies of triggers/routines.
 */
export function splitStatements(sql: string, engine: Engine): Statement[] {
  const out: Statement[] = []
  let delimiter = ';'
  let stmtStart = 0
  let hasContent = false
  let head = ''
  let blockStmt: boolean | undefined
  let depth = 0

  const finish = (end: number, after: number) => {
    if (hasContent) {
      let s = stmtStart
      let e = end
      while (s < e && /\s/.test(sql[s])) s++
      while (e > s && /\s/.test(sql[e - 1])) e--
      out.push({ text: sql.slice(s, e), start: s, end: e, endWithDelimiter: after })
    }
    stmtStart = after
    hasContent = false
    head = ''
    blockStmt = undefined
    depth = 0
  }

  for (const t of lex(sql, engine)) {
    if (t.type !== 'code') {
      if (t.type !== 'comment') {
        hasContent = true
        head += ' x '
      }
      continue
    }
    let j = t.start
    while (j < t.end) {
      const c = sql[j]
      const atLineStart = /^[ \t]*$/.test(sql.slice(sql.lastIndexOf('\n', j - 1) + 1, j))
      if (engine === 'mysql' && (c === 'D' || c === 'd') && atLineStart) {
        const m = /^DELIMITER[ \t]+(\S+)[^\n]*/i.exec(sql.slice(j, t.end))
        if (m) {
          finish(j, j + m[0].length)
          delimiter = m[1]
          j += m[0].length
          continue
        }
      }
      if (depth === 0 && sql.startsWith(delimiter, j)) {
        finish(j, j + delimiter.length)
        j += delimiter.length
        continue
      }
      if (/[A-Za-z_]/.test(c) && !isWordChar(sql[j - 1])) {
        const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(j, t.end))![0]
        const upper = word.toUpperCase()
        if (engine !== 'postgres' && (upper === 'BEGIN' || upper === 'CASE' || upper === 'END')) {
          blockStmt ??= BLOCK_STATEMENT.test(head)
          if (blockStmt) {
            if (upper !== 'END') depth++
            else {
              const following = /^\s+([A-Za-z]+)/.exec(sql.slice(j + 3, j + 20))?.[1]?.toUpperCase()
              if (!following || !UNCOUNTED_END.has(following)) depth = Math.max(0, depth - 1)
            }
          }
        }
        hasContent = true
        head += word + ' '
        j += word.length
        continue
      }
      if (!/\s/.test(c)) hasContent = true
      if (head.length < 400) head += c
      j++
    }
  }
  finish(sql.length, sql.length)
  return out
}

/** Statement under the caret; on blank space, the nearest preceding statement. */
export function statementAt(stmts: Statement[], offset: number): Statement | undefined {
  const inside = stmts.find((s) => offset >= s.start && offset <= s.endWithDelimiter)
  if (inside) return inside
  const before = stmts.filter((s) => s.endWithDelimiter < offset)
  return before.at(-1) ?? stmts[0]
}

export interface ParamRef {
  name: string
  start: number
  end: number
}

/** Bind-variable references outside strings/comments: `:name`, `$1` (PostgreSQL), `?` (MySQL/SQLite). */
export function findParams(sql: string, engine: Engine): ParamRef[] {
  const out: ParamRef[] = []
  let positional = 0
  const re = engine === 'postgres' ? /(?<![:\w]):([A-Za-z_]\w*)|(?<![\w$])\$(\d+)\b/g : /(?<![:\w]):([A-Za-z_]\w*)|\?/g
  for (const t of lex(sql, engine)) {
    if (t.type !== 'code') continue
    re.lastIndex = 0
    const text = sql.slice(t.start, t.end)
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const name = m[1] ?? (m[2] ? `$${m[2]}` : `?${++positional}`)
      out.push({ name, start: t.start + m.index, end: t.start + m.index + m[0].length })
    }
  }
  return out
}

export const paramLabel = (name: string) => (/^[$?]/.test(name) ? name : `:${name}`)

/** Rewrites parameters into the driver's native placeholder style. */
export function bindParams(
  sql: string,
  engine: Engine,
  values: Record<string, CellValue>
): { sql: string; params: CellValue[] } {
  const refs = findParams(sql, engine)
  const valueOf = (name: string) => {
    if (!(name in values)) throw new Error(`No value for parameter ${paramLabel(name)}`)
    return values[name]
  }
  const params: CellValue[] = []
  const numbers = new Map<string, number>()
  if (engine === 'postgres') {
    let max = 0
    for (const r of refs) if (r.name.startsWith('$')) max = Math.max(max, Number(r.name.slice(1)))
    for (const r of refs) {
      if (r.name.startsWith('$')) numbers.set(r.name, Number(r.name.slice(1)))
      else if (!numbers.has(r.name)) numbers.set(r.name, ++max)
    }
    for (const [name, n] of numbers) params[n - 1] = valueOf(name)
  }
  let text = ''
  let last = 0
  for (const r of refs) {
    text += sql.slice(last, r.start)
    if (engine === 'postgres') text += `$${numbers.get(r.name)}`
    else {
      text += '?'
      params.push(valueOf(r.name))
    }
    last = r.end
  }
  text += sql.slice(last)
  return { sql: text, params: Array.from(params, (p) => (p === undefined ? null : p)) }
}

/** First keyword of a statement, upper-cased (comments skipped). */
export function leadingKeyword(sql: string, engine: Engine): string {
  for (const t of lex(sql, engine)) {
    if (t.type === 'comment') continue
    const m = /^\s*([A-Za-z]+)/.exec(sql.slice(t.start, t.end))
    return m ? m[1].toUpperCase() : ''
  }
  return ''
}
