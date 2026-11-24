// JSON cell viewer helpers: which cells hold JSON, pretty printing, and tokens to color it.
import type { CellValue } from './model'

/** json/jsonb columns, or any text that is a JSON object or array */
export function isJsonCell(type: string, v: CellValue | undefined): v is string {
  if (typeof v !== 'string') return false
  if (/json/i.test(type)) return true
  const t = v.trim()
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

export function prettyJson(text: string): { ok: boolean; text: string; error?: string } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) }
  } catch (err) {
    return { ok: false, text, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface JsonToken {
  type: 'key' | 'string' | 'number' | 'literal' | 'punct'
  text: string
}

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|\b(true|false|null)\b|([^"\-\d tfn]+|[\s\S])/g

/** Splits (pretty) JSON into colorable pieces; concatenating the texts gives the input back. */
export function jsonTokens(text: string): JsonToken[] {
  const out: JsonToken[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1]) {
      out.push({ type: m[2] ? 'key' : 'string', text: m[1] })
      if (m[2]) out.push({ type: 'punct', text: m[2] })
    } else if (m[3]) out.push({ type: 'number', text: m[3] })
    else if (m[4]) out.push({ type: 'literal', text: m[4] })
    else out.push({ type: 'punct', text: m[5] })
  }
  return out
}
