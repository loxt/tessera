// Quick chart from a query result: which columns can be plotted, a sensible first choice, the series
// (repeated X values summed), and 1-2-5 axis ticks. Rendering lives in the renderer (ChartView).
import { cellText } from './export'
import type { CellValue, ResultSet } from './model'

export type ChartType = 'bar' | 'line'

/** the validated categorical palette holds three series in every pairing */
export const MAX_SERIES = 3

const NUMBER = /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/
const TEMPORAL = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2})?)?/

const asNumber = (v: CellValue): number | null => (typeof v === 'number' ? v : typeof v === 'string' && NUMBER.test(v) ? Number(v) : null)

export function numericColumns(r: ResultSet): number[] {
  return r.columns
    .map((_, c) => c)
    .filter((c) => {
      const present = r.rows.map((row) => row[c]).filter((v) => v !== null)
      return present.length > 0 && present.every((v) => asNumber(v) !== null)
    })
}

/** X: the first column that is not numeric (else the first); Y: the numeric ones; dates draw as lines. */
export function guessChart(r: ResultSet): { x: number; ys: number[]; type: ChartType } {
  const nums = numericColumns(r)
  const x = r.columns.findIndex((_, c) => !nums.includes(c))
  const xi = x >= 0 ? x : 0
  const temporal = r.rows.length > 0 && r.rows.every((row) => row[xi] === null || TEMPORAL.test(cellText(row[xi])))
  return { x: xi, ys: nums.filter((c) => c !== xi).slice(0, MAX_SERIES), type: temporal ? 'line' : 'bar' }
}

export interface Series {
  labels: string[]
  /** one array per Y column, aligned with labels; null where no value */
  values: (number | null)[][]
  /** some X value repeated and its rows were added up */
  summed: boolean
}

export function buildSeries(r: ResultSet, x: number, ys: number[]): Series {
  const index = new Map<string, number>()
  const labels: string[] = []
  const values: (number | null)[][] = ys.map(() => [])
  let summed = false
  for (const row of r.rows) {
    const label = row[x] === null ? 'NULL' : cellText(row[x])
    let i = index.get(label)
    if (i === undefined) {
      i = labels.length
      index.set(label, i)
      labels.push(label)
      values.forEach((v) => v.push(null))
    } else summed = true
    ys.forEach((c, s) => {
      const n = asNumber(row[c])
      if (n !== null) values[s][i!] = (values[s][i!] ?? 0) + n
    })
  }
  return { labels, values, summed }
}

/** Ticks on 1-2-5 steps covering [min, max], always including zero when the data is all positive. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const lo = Math.min(0, min)
  let hi = Math.max(0, max)
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const start = Math.floor(lo / step) * step
  const out: number[] = []
  for (let t = start; t < hi + step - 1e-9; t += step) out.push(Number(t.toPrecision(12)))
  return out
}
