import type { PlanNode } from '@shared/model'
import { Icon } from '../components/Icon'
import { planRows } from './plan'

interface Row {
  node: PlanNode
  depth: number
}

const flatten = (nodes: PlanNode[], depth = 0): Row[] => nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])

const fmt = (n: number | undefined, digits = 2) => (n === undefined ? '' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(digits))

/** share of the whole plan at which a node is called out as the hot spot */
const HOT_SHARE = 0.4

/** The plan as indented text (operation, rows, cost, time, details) for the AI assistant. */
export const planText = (plan: PlanNode[]): string =>
  flatten(plan)
    .map(({ node, depth }) =>
      [
        '  '.repeat(depth) + node.label,
        node.rows !== undefined && `rows=${node.rows}`,
        node.cost !== undefined && `cost=${node.cost}`,
        node.time !== undefined && `time_ms=${node.time}`,
        node.detail
      ]
        .filter(Boolean)
        .join('  ')
    )
    .join('\n')

export function PlanView({ plan, onAnalyze }: { plan: PlanNode[]; onAnalyze?: () => void }) {
  const { rows, metric } = planRows(plan)
  const hasTime = metric === 'time'
  // SQLite's EXPLAIN QUERY PLAN has neither cost nor time: no bars to draw
  const measured = rows.some((r) => r.node.cost !== undefined || r.node.time !== undefined)
  const hottest = rows.reduce<(typeof rows)[number] | undefined>((a, r) => (!a || r.share > a.share ? r : a), undefined)
  return (
    <div className="plan">
      {(onAnalyze || (hottest && hottest.share > 0)) && (
        <div className="plan-bar">
          {hottest && hottest.share > 0 ? (
            <span className="plan-summary">
              Most {hasTime ? 'time' : 'cost'} is spent in <b>{hottest.node.label}</b>
              <span className="muted-inline"> · {Math.round(hottest.share * 100)}% of the plan</span>
            </span>
          ) : (
            <span className="muted small">Run Explain Analyze to see where the time goes.</span>
          )}
          {onAnalyze && (
            <button className="btn soft small" onClick={onAnalyze}>
              <Icon name="spark" /> Analyze with AI
            </button>
          )}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Operation</th>
            <th style={{ textAlign: 'right' }}>Rows</th>
            <th style={{ textAlign: 'right' }}>Cost</th>
            {hasTime && <th style={{ textAlign: 'right' }}>Time (ms)</th>}
            {measured && <th style={{ width: '22%' }}>Self {hasTime ? 'time' : 'cost'}</th>}
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth, share }, i) => {
            const hot = share >= HOT_SHARE
            return (
              <tr key={i} className={hot ? 'hot' : undefined}>
                <td style={{ paddingLeft: 12 + depth * 18 }}>
                  {depth > 0 && <span className="muted">└ </span>}
                  <span className="plan-op">{node.label}</span>
                </td>
                <td className="num">{fmt(node.rows, 0)}</td>
                <td className="num">{fmt(node.cost)}</td>
                {hasTime && <td className="num">{fmt(node.time, 3)}</td>}
                {measured && (
                  <td>
                    <div className="plan-track" title={`${Math.round(share * 100)}% of the plan`}>
                      <div className={`bar${hot ? ' hot' : ''}`} style={{ width: `${Math.max(1, share * 100)}%` }} />
                    </div>
                  </td>
                )}
                <td className="muted mono">{node.detail}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
