// Spreadsheet-style summary of selected cells: count, NULLs, distinct values, and sum / avg / min /
// max when every non-NULL value is a number (exact numerics arrive as strings).
import type { CellValue } from './model'

export interface Summary {
  count: number
  nulls: number
  distinct: number
  numeric?: { sum: number; avg: number; min: number; max: number }
}

const NUMBER = /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/

const asNumber = (v: CellValue): number | null => {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && NUMBER.test(v)) return Number(v)
  return null
}

const key = (v: CellValue) => (v !== null && typeof v === 'object' ? `0x${v.hex}` : `${typeof v}:${String(v)}`)

export function summarize(values: CellValue[]): Summary {
  const present = values.filter((v) => v !== null)
  const out: Summary = { count: values.length, nulls: values.length - present.length, distinct: new Set(present.map(key)).size }
  const nums = present.map(asNumber)
  if (!present.length || nums.some((n) => n === null)) return out
  const list = nums as number[]
  // reduce, not Math.min(...list): spreading a whole-column selection overflows the stack
  const sum = list.reduce((a, b) => a + b, 0)
  const min = list.reduce((a, b) => (b < a ? b : a))
  const max = list.reduce((a, b) => (b > a ? b : a))
  return { ...out, numeric: { sum, avg: sum / list.length, min, max } }
}
