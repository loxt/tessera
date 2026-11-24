import { describe, expect, test } from 'vitest'
import { resolveTypedPath } from './paths'

const HOME = '/Users/me'

describe('resolveTypedPath', () => {
  test('keeps an absolute path, normalized', () => {
    expect(resolveTypedPath('/tmp/out/../result.csv', HOME)).toBe('/tmp/result.csv')
  })

  test('expands a leading ~ to the home directory', () => {
    expect(resolveTypedPath('~/Downloads/result.csv', HOME)).toBe('/Users/me/Downloads/result.csv')
    expect(resolveTypedPath('~', HOME)).toBe('/Users/me')
  })

  test('trims whitespace and the quotes a pasted path often carries', () => {
    expect(resolveTypedPath('  "/tmp/my file.csv"\n', HOME)).toBe('/tmp/my file.csv')
    expect(resolveTypedPath("'/tmp/a.csv'", HOME)).toBe('/tmp/a.csv')
  })

  test('accepts a pasted file:// URL', () => {
    expect(resolveTypedPath('file:///tmp/my%20file.csv', HOME)).toBe('/tmp/my file.csv')
  })

  test('rejects empty, relative and ~user paths with a readable message', () => {
    expect(() => resolveTypedPath('   ', HOME)).toThrow('Enter a file path')
    expect(() => resolveTypedPath('result.csv', HOME)).toThrow('absolute')
    expect(() => resolveTypedPath('~other/result.csv', HOME)).toThrow('absolute')
  })

  test('rejects non-string input from the renderer', () => {
    expect(() => resolveTypedPath(42 as unknown as string, HOME)).toThrow('Enter a file path')
  })
})
