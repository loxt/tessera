import { describe, expect, it } from 'vitest'
import { summarize } from './aggregate'

describe('summarize', () => {
  it('adds up numbers, including exact numerics that travel as strings', () => {
    expect(summarize([1, '2.5', 3, null])).toEqual({ count: 4, nulls: 1, distinct: 3, numeric: { sum: 6.5, avg: 6.5 / 3, min: 1, max: 3 } })
  })

  it('has no numeric part when any value is text', () => {
    expect(summarize(['a', 'b', 'a', 1])).toEqual({ count: 4, nulls: 0, distinct: 3 })
  })

  it('treats booleans and binary as non-numeric', () => {
    expect(summarize([true, false]).numeric).toBeUndefined()
    expect(summarize([{ $t: 'binary', hex: '00', size: 1 }]).numeric).toBeUndefined()
  })

  it('has no numeric part for only NULLs or empty strings', () => {
    expect(summarize([null, null])).toEqual({ count: 2, nulls: 2, distinct: 0 })
    expect(summarize(['', ' ']).numeric).toBeUndefined()
  })
})
