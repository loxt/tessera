import { app, net } from 'electron'
import { newerRelease, RELEASES_REPO, type UpdateInfo } from '@shared/update'

const TIMEOUT_MS = 10_000

/** Asks GitHub for the latest release; null when up to date, in dev builds, or when GitHub can't be reached. */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  // dev builds report package.json's version, which CI never bumps: every release would look new
  if (!app.isPackaged) return null
  try {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const { tag_name } = (await res.json()) as { tag_name?: unknown }
    return newerRelease(app.getVersion(), tag_name)
  } catch (err) {
    console.warn('[tessera] update check failed', err) // offline or rate-limited: no badge, try again later
    return null
  }
}
