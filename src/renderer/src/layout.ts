import type { PaneLayout } from '@shared/model'

type Pane = PaneLayout['panes'][number]

export const single = (): PaneLayout => ({ panes: [{ tabIds: [] }], focused: 0, orientation: 'row', ratio: 0.5 })

export const activeOf = (l: PaneLayout): string | undefined => l.panes[l.focused]?.activeId

export const paneOf = (l: PaneLayout, id: string): number => l.panes.findIndex((p) => p.tabIds.includes(id))

const withPanes = (l: PaneLayout, panes: Pane[], focused = l.focused): PaneLayout =>
  panes.length === 1 ? { ...l, panes, focused: 0 } : { ...l, panes, focused: Math.min(focused, panes.length - 1) }

/** Makes the layout consistent with the open tabs (restored sessions, closed connections). */
export function normalizeLayout(saved: PaneLayout | undefined, tabIds: string[]): PaneLayout {
  const base = saved ?? single()
  const seen = new Set<string>()
  const panes = base.panes.map((p) => {
    const ids = p.tabIds.filter((id) => tabIds.includes(id) && !seen.has(id) && !!seen.add(id))
    return { tabIds: ids, activeId: ids.includes(p.activeId ?? '') ? p.activeId : ids[0] }
  })
  const orphans = tabIds.filter((id) => !seen.has(id))
  panes[0] = { tabIds: [...panes[0].tabIds, ...orphans], activeId: panes[0].activeId ?? orphans[0] }
  const kept = panes.filter((p, i) => i === 0 || p.tabIds.length)
  return withPanes(base, kept)
}

export function addTab(l: PaneLayout, id: string): PaneLayout {
  const panes = l.panes.map((p, i) => (i === l.focused ? { tabIds: [...p.tabIds, id], activeId: id } : p))
  return { ...l, panes }
}

export function activate(l: PaneLayout, id: string): PaneLayout {
  const i = paneOf(l, id)
  if (i < 0) return l
  return { ...l, focused: i, panes: l.panes.map((p, k) => (k === i ? { ...p, activeId: id } : p)) }
}

export const focusPane = (l: PaneLayout, i: number): PaneLayout => (i >= 0 && i < l.panes.length ? { ...l, focused: i } : l)

/** Removes a tab; the pane falls back to its most recently used tab, and an emptied second pane disappears. */
export function removeTab(l: PaneLayout, id: string, recent: string[]): PaneLayout {
  const i = paneOf(l, id)
  if (i < 0) return l
  const p = l.panes[i]
  const idx = p.tabIds.indexOf(id)
  const tabIds = p.tabIds.filter((t) => t !== id)
  const activeId = p.activeId !== id ? p.activeId : (recent.find((r) => tabIds.includes(r)) ?? tabIds[Math.max(0, idx - 1)])
  const panes = l.panes.map((x, k) => (k === i ? { tabIds, activeId } : x))
  if (!tabIds.length && panes.length === 2) return withPanes(l, panes.filter((_, k) => k !== i), 0)
  return { ...l, panes }
}

/** "Split Right/Down" and "Move to Opposite Split": a pane is never left empty by a move. */
export function moveToOtherPane(l: PaneLayout, id: string, orientation: PaneLayout['orientation']): PaneLayout {
  const from = paneOf(l, id)
  if (from < 0) return l
  if (l.panes.length === 1) {
    if (l.panes[0].tabIds.length < 2) return l
    const rest = l.panes[0].tabIds.filter((t) => t !== id)
    const left = { tabIds: rest, activeId: l.panes[0].activeId === id ? rest.at(-1) : l.panes[0].activeId }
    return { ...l, orientation, panes: [left, { tabIds: [id], activeId: id }], focused: 1 }
  }
  const to = 1 - from
  const moved = removeTab({ ...l }, id, [])
  if (moved.panes.length === 1) return l // it was that pane's only tab: nothing to split
  const panes = moved.panes.map((p, k) => (k === to ? { tabIds: [...p.tabIds, id], activeId: id } : p))
  return { ...moved, panes, focused: to }
}

export function unsplit(l: PaneLayout): PaneLayout {
  if (l.panes.length === 1) return l
  const active = activeOf(l)
  return { ...l, panes: [{ tabIds: l.panes.flatMap((p) => p.tabIds), activeId: active }], focused: 0 }
}
