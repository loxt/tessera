import type { PlanNode } from '@shared/model'

export interface PlanRow {
  node: PlanNode
  depth: number
  /** this node's own work (its total minus its children's), as a share of the whole plan, 0..1 */
  share: number
}

/**
 * Flattens a plan tree and works out where the work really happens. Engines report a node's
 * time/cost including its children, so the parent of a slow scan looks just as slow; the
 * self value (total minus children) points at the node that actually costs. Uses actual time
 * when the plan was analyzed, estimated cost otherwise.
 */
export function planRows(plan: PlanNode[]): { rows: PlanRow[]; metric: 'time' | 'cost' } {
  const metric = hasValue(plan, 'time') ? 'time' : 'cost'
  const value = (n: PlanNode) => n[metric] ?? 0
  const self = (n: PlanNode) => Math.max(0, value(n) - n.children.reduce((a, c) => a + value(c), 0))
  const flat: { node: PlanNode; depth: number; self: number }[] = []
  const walk = (nodes: PlanNode[], depth: number) => {
    for (const node of nodes) {
      flat.push({ node, depth, self: self(node) })
      walk(node.children, depth + 1)
    }
  }
  walk(plan, 0)
  const total = flat.reduce((a, r) => a + r.self, 0)
  return { rows: flat.map((r) => ({ node: r.node, depth: r.depth, share: total > 0 ? r.self / total : 0 })), metric }
}

function hasValue(nodes: PlanNode[], key: 'time' | 'cost'): boolean {
  return nodes.some((n) => n[key] !== undefined || hasValue(n.children, key))
}
