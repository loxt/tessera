// Per-data-source usage counts for completion ranking, computed from query history and refreshed
// in the background (completion stays synchronous and never waits for IPC).
import type { Engine } from '@shared/model'
import { api } from '../api'
import { computeUsage, type Usage } from './completion'

const REFRESH_MS = 30_000
const cache = new Map<string, { usage: Usage; at: number; loading: boolean }>()
const EMPTY: Usage = { tables: new Map(), columns: new Map() }

/** Latest known usage for the data source; starts a refresh when it is missing or stale. */
export function usageFor(connectionId: string, engine: Engine): Usage {
  const hit = cache.get(connectionId)
  if (!hit || (!hit.loading && Date.now() - hit.at > REFRESH_MS)) {
    cache.set(connectionId, { usage: hit?.usage ?? EMPTY, at: hit?.at ?? 0, loading: true })
    api
      .history(connectionId)
      .then((entries) => cache.set(connectionId, { usage: computeUsage(entries, engine, Date.now()), at: Date.now(), loading: false }))
      // ranking is a nicety: without history, completion simply falls back to alphabetical order
      .catch(() => cache.set(connectionId, { usage: hit?.usage ?? EMPTY, at: Date.now(), loading: false }))
  }
  return cache.get(connectionId)!.usage
}
