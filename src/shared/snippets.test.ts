import { describe, expect, it } from 'vitest'
import { DEFAULT_SNIPPETS, matchSnippets, placeholderNames, sanitizeSnippets, toMonacoSnippet } from './snippets'

describe('toMonacoSnippet', () => {
  it('turns {{name}} into numbered tab stops and repeats into mirrors', () => {
    expect(toMonacoSnippet('SELECT {{column}}, count(*) FROM {{table}} GROUP BY {{column}}')).toBe('SELECT ${1:column}, count(*) FROM ${2:table} GROUP BY $1')
  })

  it('places the final caret at {{cursor}}', () => {
    expect(toMonacoSnippet('SELECT * FROM {{table}} WHERE {{cursor}}')).toBe('SELECT * FROM ${1:table} WHERE $0')
  })

  it('escapes the snippet grammar in literal SQL', () => {
    expect(toMonacoSnippet("SELECT '$1' || '}' || E'\\n' FROM {{t}}")).toBe("SELECT '\\$1' || '\\}' || E'\\\\n' FROM ${1:t}")
  })

  it('escapes placeholder default text', () => {
    expect(toMonacoSnippet('{{a$b}}')).toBe('${1:a\\$b}')
  })
})

describe('placeholderNames', () => {
  it('lists distinct placeholders in order, without cursor', () => {
    expect(placeholderNames('{{table}} {{ column }} {{table}} {{cursor}}')).toEqual(['table', 'column'])
  })
})

describe('matchSnippets', () => {
  it('matches by prefix, ignoring case, only when something was typed', () => {
    const list = [
      { prefix: 'sel', name: 'Select', body: 'SELECT' },
      { prefix: 'cnt', name: 'Count', body: 'SELECT count(*)' }
    ]
    expect(matchSnippets(list, 'SE').map((s) => s.prefix)).toEqual(['sel'])
    expect(matchSnippets(list, '')).toEqual([])
  })
})

describe('sanitizeSnippets', () => {
  it('keeps well-formed snippets and drops the rest', () => {
    const out = sanitizeSnippets([
      { prefix: 'ok', name: 'Fine', body: 'SELECT 1' },
      { prefix: 'ok', name: 'Duplicate prefix', body: 'SELECT 2' },
      { prefix: '1bad', name: 'Starts with a digit', body: 'x' },
      { prefix: 'nobody', name: 'Empty body', body: '' },
      { prefix: 'x', name: 42, body: 'x' },
      'nonsense'
    ])
    expect(out).toEqual([{ prefix: 'ok', name: 'Fine', body: 'SELECT 1' }])
  })

  it('accepts the defaults unchanged', () => {
    expect(sanitizeSnippets(DEFAULT_SNIPPETS)).toEqual(DEFAULT_SNIPPETS)
  })

  it('returns an empty list for anything that is not a list', () => {
    expect(sanitizeSnippets(null)).toEqual([])
  })
})
