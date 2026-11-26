export const RELEASES_REPO = 'loxt/tessera'

export interface UpdateInfo {
  version: string
  url: string
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

/** Parses "1.2.3" / "v1.2.3"; null for anything else (pre-releases included). */
export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** The release worth announcing: `latestTag` when it is a newer version than `current`, else null. */
export function newerRelease(current: string, latestTag: unknown): UpdateInfo | null {
  if (typeof latestTag !== 'string') return null
  const a = parseVersion(current)
  const b = parseVersion(latestTag)
  if (!a || !b) return null
  const diff = b.map((n, i) => n - a[i]).find((d) => d !== 0) ?? 0
  if (diff <= 0) return null
  const version = b.join('.')
  return { version, url: `https://github.com/${RELEASES_REPO}/releases/tag/v${version}` }
}
