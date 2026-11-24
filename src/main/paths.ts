import { isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A path the user typed or pasted → absolute normalized path. Accepts `~/…`, surrounding quotes
 * and file:// URLs (what Finder and terminals tend to put on the clipboard); throws a readable message otherwise.
 */
export function resolveTypedPath(input: string, home: string): string {
  const raw = typeof input === 'string' ? input.trim().replace(/^(["'])(.*)\1$/s, '$2').trim() : ''
  if (!raw) throw new Error('Enter a file path')
  const path = raw.startsWith('file://') ? fileURLToPath(raw) : raw === '~' || raw.startsWith('~/') ? join(home, raw.slice(1)) : raw
  if (!isAbsolute(path)) throw new Error(`Use an absolute path, like ~/Downloads/result.csv (got "${raw}")`)
  return normalize(path)
}
