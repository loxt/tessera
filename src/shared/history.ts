// Query history search: every typed word must appear (SQL or error text), plus quick status filters.
import type { HistoryEntry } from './model'

export type HistoryStatus = 'all' | 'failed' | 'slow'

/** queries at or above this duration count as slow */
export const SLOW_MS = 1000

const DAY_MS = 86_400_000

export function searchHistory(entries: HistoryEntry[], text: string, status: HistoryStatus): HistoryEntry[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => {
    if (status === 'failed' && e.ok) return false
    if (status === 'slow' && e.durationMs < SLOW_MS) return false
    const haystack = `${e.sql}\n${e.error ?? ''}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Consecutive entries of the same calendar day share one group (entries arrive newest first). */
export function groupByDay(entries: HistoryEntry[], now: Date): { label: string; entries: HistoryEntry[] }[] {
  const today = startOfDay(now.getTime())
  const label = (t: number) => {
    const day = startOfDay(t)
    if (day === today) return 'Today'
    if (day === today - DAY_MS) return 'Yesterday'
    return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }
  const groups: { label: string; entries: HistoryEntry[] }[] = []
  for (const e of entries) {
    const l = label(e.at)
    const last = groups[groups.length - 1]
    if (last?.label === l) last.entries.push(e)
    else groups.push({ label: l, entries: [e] })
  }
  return groups
}

export const mergeHistory = (byConnection: Record<string, HistoryEntry[]>): HistoryEntry[] =>
  Object.values(byConnection)
    .flat()
    .sort((a, b) => b.at - a.at)

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)} min ${s % 60} s`
}
