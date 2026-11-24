import { describe, expect, it } from 'vitest'
import { clampFontSize, clampLineHeight, FONT_SIZE_DEFAULT, stepFontSize } from './editorFont'

describe('editor font', () => {
  it('keeps the size inside the supported range, falling back to the default', () => {
    expect(clampFontSize(4)).toBe(8)
    expect(clampFontSize(99)).toBe(40)
    expect(clampFontSize(Number.NaN)).toBe(FONT_SIZE_DEFAULT)
    expect(clampFontSize(13.6)).toBe(14)
  })

  it('steps one point at a time within the range', () => {
    expect(stepFontSize(13, 1)).toBe(14)
    expect(stepFontSize(8, -1)).toBe(8)
    expect(stepFontSize(40, 1)).toBe(40)
  })

  it('keeps line height between 1.0 and 2.5, rounded to a tenth', () => {
    expect(clampLineHeight(0.5)).toBe(1)
    expect(clampLineHeight(3)).toBe(2.5)
    expect(clampLineHeight(1.234)).toBe(1.2)
    expect(clampLineHeight(Number.NaN)).toBe(1.2)
  })
})
