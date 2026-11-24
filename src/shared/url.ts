import type { ConnectionInput, SslMode } from './model'

export type ParsedUrl = Partial<Pick<ConnectionInput, 'engine' | 'host' | 'port' | 'user' | 'password' | 'database' | 'file' | 'ssl'>>

const SCHEMES: Record<string, { engine: 'postgres' | 'mysql'; port: number }> = {
  'postgres:': { engine: 'postgres', port: 5432 },
  'postgresql:': { engine: 'postgres', port: 5432 },
  'mysql:': { engine: 'mysql', port: 3306 },
  'mariadb:': { engine: 'mysql', port: 3306 }
}

// verify-ca is upgraded to verify-full rather than silently downgraded to no verification
const SSL: Record<string, SslMode> = { disable: 'disable', allow: 'prefer', prefer: 'prefer', require: 'require', 'verify-ca': 'verify-full', 'verify-full': 'verify-full' }

/** Accepts postgres/mysql URLs (optionally `jdbc:`-prefixed), `sqlite:` URLs and bare SQLite file paths. */
export function parseConnectionUrl(input: string): ParsedUrl {
  const raw = input.trim().replace(/^jdbc:/i, '')
  if (/^sqlite:/i.test(raw)) return { engine: 'sqlite', file: raw.replace(/^sqlite:(\/\/)?/i, '') }
  if (raw.startsWith('/') || raw.startsWith('~') || /\.(db|db3|sqlite3?)$/i.test(raw)) return { engine: 'sqlite', file: raw }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Not a connection URL: ${input}`)
  }
  const scheme = SCHEMES[url.protocol]
  if (!scheme) throw new Error(`Unsupported URL scheme: ${url.protocol}`)

  const out: ParsedUrl = { engine: scheme.engine, host: url.hostname || 'localhost', port: url.port ? Number(url.port) : scheme.port }
  if (url.username) out.user = decodeURIComponent(url.username)
  if (url.password) out.password = decodeURIComponent(url.password)
  const db = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (db) out.database = db
  const ssl = url.searchParams.get('sslmode') ?? url.searchParams.get('ssl-mode')?.toLowerCase()
  if (ssl && SSL[ssl]) out.ssl = SSL[ssl]
  return out
}
