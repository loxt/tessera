// SQL snippets: type the prefix, press Tab, fill each {{placeholder}} in turn.
// Bodies use {{name}} (readable for people who never saw snippet syntax); the editor gets Monaco's
// ${1:name} tab stops, with repeated names mirrored and {{cursor}} as the final caret.

export interface Snippet {
  /** what you type before Tab: a letter, then letters, digits or _ */
  prefix: string
  name: string
  body: string
}

export const DEFAULT_SNIPPETS: Snippet[] = [
  { prefix: 'sel', name: 'Select rows', body: 'SELECT *\nFROM {{table}}\nLIMIT {{100}};' },
  { prefix: 'topn', name: 'Top N by a column', body: 'SELECT *\nFROM {{table}}\nORDER BY {{column}} DESC\nLIMIT {{10}};' },
  { prefix: 'cnt', name: 'Count rows', body: 'SELECT count(*)\nFROM {{table}}\nWHERE {{cursor}};' },
  { prefix: 'grp', name: 'Count per value', body: 'SELECT {{column}}, count(*)\nFROM {{table}}\nGROUP BY {{column}}\nORDER BY 2 DESC;' },
  { prefix: 'dup', name: 'Find duplicates', body: 'SELECT {{column}}, count(*)\nFROM {{table}}\nGROUP BY {{column}}\nHAVING count(*) > 1;' },
  { prefix: 'upd', name: 'Update one row', body: 'UPDATE {{table}}\nSET {{column}} = {{value}}\nWHERE {{id}} = {{key}};' }
]

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g
const PREFIX = /^[A-Za-z_]\w{0,31}$/
const MAX_SNIPPETS = 500
const MAX_NAME = 80
const MAX_BODY = 20_000

/** `$`, `}` and `\` are syntax inside a Monaco snippet; literal SQL must escape them. */
const escape = (s: string) => s.replace(/[\\$}]/g, (ch) => `\\${ch}`)

export function toMonacoSnippet(body: string): string {
  const stops = new Map<string, number>()
  let out = ''
  let last = 0
  for (const m of body.matchAll(PLACEHOLDER)) {
    out += escape(body.slice(last, m.index))
    last = m.index + m[0].length
    const name = m[1]
    if (name === 'cursor') {
      out += '$0'
      continue
    }
    const n = stops.get(name)
    if (n) out += `$${n}`
    else {
      stops.set(name, stops.size + 1)
      out += `\${${stops.size}:${escape(name)}}`
    }
  }
  return out + escape(body.slice(last))
}

export const placeholderNames = (body: string): string[] => [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => n !== 'cursor'))]

export function matchSnippets(snippets: Snippet[], word: string): Snippet[] {
  const w = word.toLowerCase()
  return w ? snippets.filter((s) => s.prefix.toLowerCase().startsWith(w)) : []
}

export const isValidPrefix = (prefix: string): boolean => PREFIX.test(prefix)

/** Validates snippets at the IPC boundary: well-formed fields, unique prefixes, bounded sizes. */
export function sanitizeSnippets(list: unknown): Snippet[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: Snippet[] = []
  for (const s of list.slice(0, MAX_SNIPPETS)) {
    if (!s || typeof s !== 'object') continue
    const { prefix, name, body } = s as Record<string, unknown>
    if (typeof prefix !== 'string' || !isValidPrefix(prefix) || seen.has(prefix.toLowerCase())) continue
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME) continue
    if (typeof body !== 'string' || !body.trim() || body.length > MAX_BODY) continue
    seen.add(prefix.toLowerCase())
    out.push({ prefix, name, body })
  }
  return out
}
