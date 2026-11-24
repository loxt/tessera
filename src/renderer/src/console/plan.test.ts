import { describe, expect, test } from 'vitest'
import type { PlanNode } from '@shared/model'
import { planRows } from './plan'

const node = (label: string, v: Partial<PlanNode>, children: PlanNode[] = []): PlanNode => ({ label, children, ...v })

describe('planRows', () => {
  test('self time is the node total minus its children, so the slow leaf stands out', () => {
    const plan = [node('Hash Join', { time: 200 }, [node('Seq Scan', { time: 150 }), node('Hash', { time: 10 })])]
    const { rows, metric } = planRows(plan)
    expect(metric).toBe('time')
    expect(rows.map((r) => [r.node.label, r.depth, Math.round(r.share * 100)])).toEqual([
      ['Hash Join', 0, 20],
      ['Seq Scan', 1, 75],
      ['Hash', 1, 5]
    ])
  })

  test('falls back to estimated cost when the plan was not analyzed', () => {
    const { rows, metric } = planRows([node('Sort', { cost: 10 }, [node('Index Scan', { cost: 10 })])])
    expect(metric).toBe('cost')
    expect(rows.map((r) => r.share)).toEqual([0, 1])
  })
})
