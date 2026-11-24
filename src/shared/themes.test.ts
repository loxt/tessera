import { describe, expect, test } from 'vitest'
import { resolveThemeId } from './themes'

describe('resolveThemeId', () => {
  test('ids saved before the rename map to the Tessera themes', () => {
    expect(resolveThemeId('lattice-dark', false)).toBe('tessera-graphite')
    expect(resolveThemeId('lattice-light', true)).toBe('tessera-paper')
    expect(resolveThemeId('dark', false)).toBe('tessera-graphite')
  })

  test('system follows macOS; unknown ids fall back the same way', () => {
    expect(resolveThemeId('system', true)).toBe('tessera-graphite')
    expect(resolveThemeId('gone-theme', false)).toBe('tessera-paper')
    expect(resolveThemeId('catppuccin-mocha', false)).toBe('catppuccin-mocha')
  })
})
