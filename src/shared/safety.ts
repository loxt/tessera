// Guards before running SQL: which statements write, which are dangerous (UPDATE/DELETE without WHERE,
// DROP, TRUNCATE), and what confirmation that asks for. Production asks before every write and makes the
// user type the data source name for dangerous ones; elsewhere only dangerous statements ask.
import type { Environment } from './environment'
import type { Engine } from './model'
import { leadingKeyword, lex } from './sql'

export interface Risk {
  level: 'read' | 'write' | 'dangerous'
  reason?: string
}

export interface Confirmation {
  /** production + dangerous: the data source name must be typed */
  typed: boolean
  /** the statements that triggered it */
  statements: string[]
  reasons: string[]
}

const READS = new Set(['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC', 'PRAGMA', 'VALUES', 'TABLE', 'SET', 'USE', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'])

/** Code only: strings and comments blanked, nested parentheses removed, lower-cased. */
function topLevel(sql: string, engine: Engine): string {
  const code = lex(sql, engine)
    .map((t) => (t.type === 'code' || t.type === 'ident' ? sql.slice(t.start, t.end) : ' '))
    .join('')
  let out = ''
  let depth = 0
  for (const ch of code) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  return out.toLowerCase()
}

const target = (text: string, after: RegExp) => after.exec(text)?.[1]?.replace(/[`"]/g, '') ?? 'the table'

/** Functions that change state even inside a SELECT. */
const SIDE_EFFECTS = /\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|nextval|setval|lo_import|lo_export|lo_unlink|set_config|dblink_exec|pg_advisory_lock|pg_advisory_xact_lock|pg_try_advisory_lock|pg_switch_wal|pg_promote|get_lock|release_lock)\s*\(/

/** A statement whose leading keyword names it: UPDATE, DELETE, DROP… checked for the dangerous shapes. */
function assessCommand(head: string, top: string): Risk | null {
  if (head === 'DROP') return { level: 'dangerous', reason: `DROP removes ${target(top, /\bdrop\s+(?:table|view|schema|database|index)?\s*(?:if\s+exists\s+)?([\w."`]+)/)}` }
  if (head === 'TRUNCATE') return { level: 'dangerous', reason: `TRUNCATE empties ${target(top, /\btruncate\s+(?:table\s+)?([\w."`]+)/)}` }
  if (head === 'ALTER' && /\bdrop\b/.test(top)) return { level: 'dangerous', reason: 'ALTER … DROP removes part of the schema' }
  if ((head === 'UPDATE' || head === 'DELETE') && !/\bwhere\b/.test(top)) {
    const table = head === 'UPDATE' ? target(top, /\bupdate\s+(?:only\s+)?([\w."`]+)/) : target(top, /\bdelete\s+from\s+(?:only\s+)?([\w."`]+)/)
    return { level: 'dangerous', reason: `${head} without WHERE changes every row of ${table}` }
  }
  return null
}

export function assessRisk(sql: string, engine: Engine): Risk {
  // "(select …) union (select …)": read through the leading parentheses
  const body = sql.replace(/^[\s(]+/, '')
  const head = leadingKeyword(body, engine)
  const top = topLevel(sql, engine)
  const code = lex(sql, engine)
    .filter((t) => t.type === 'code')
    .map((t) => sql.slice(t.start, t.end).toLowerCase())
    .join(' ')
  const named = assessCommand(head, top)
  if (named) return named
  if (head === 'WITH') {
    // the statement after the CTEs, at top level: WITH x AS (…) DELETE FROM t
    // ("for update" is a locking read, not an UPDATE)
    const main = /(?<!\bfor\s+(?:no\s+key\s+)?)\b(update|delete)\b/.exec(top)
    if (main) return assessCommand(main[1].toUpperCase(), top.slice(main.index)) ?? { level: 'write' }
    // a CTE can hide a write: WITH d AS (DELETE …) SELECT …
    if (/\b(insert|update|delete|merge)\b/.test(code)) return { level: 'write' }
  }
  if (head === 'EXPLAIN' && /\banalyze\b/.test(top)) {
    // EXPLAIN ANALYZE runs the statement it explains
    const inner = /\b(insert|update|delete|merge|drop|truncate|alter|create)\b/.exec(top)
    if (inner) return assessCommand(inner[1].toUpperCase(), top.slice(inner.index)) ?? { level: 'write' }
  }
  if (head === 'SELECT' || head === 'WITH' || head === 'VALUES' || head === 'TABLE') {
    if (/\binto\s+(outfile|dumpfile|\w)/.test(top) || /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/.test(top) || SIDE_EFFECTS.test(code)) return { level: 'write' }
    return { level: 'read' }
  }
  if (head === 'PRAGMA') return /=/.test(top) ? { level: 'write' } : { level: 'read' }
  if (head === 'SET') return /^\s*set\s+(global|persist|role|session\s+authorization|password)\b/.test(top) ? { level: 'write' } : { level: 'read' }
  // unknown shapes count as writes: asking once too often beats running something unexpected
  return READS.has(head) ? { level: 'read' } : { level: 'write' }
}

export function confirmationFor(statements: string[], engine: Engine, env: Environment | undefined, readOnly: boolean): Confirmation | null {
  // read-only sources reject writes on the server; asking first would only add a step
  if (readOnly) return null
  const risks = statements.map((sql) => ({ sql, risk: assessRisk(sql, engine) }))
  const dangerous = risks.filter((r) => r.risk.level === 'dangerous')
  const prod = env === 'production'
  const asking = prod ? risks.filter((r) => r.risk.level !== 'read') : dangerous
  if (!asking.length) return null
  return {
    typed: prod && dangerous.length > 0,
    statements: asking.map((r) => r.sql),
    reasons: [...new Set(dangerous.map((r) => r.risk.reason ?? ''))].filter(Boolean)
  }
}
