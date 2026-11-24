import { describe, expect, it } from 'vitest'
import { isJsonCell, prettyJson, jsonTokens } from './json'

describe('isJsonCell', () => {
  it('accepts json/jsonb columns and object or array text', () => {
    expect(isJsonCell('jsonb', '{"a":1}')).toBe(true)
    expect(isJsonCell('json', '42')).toBe(true)
    expect(isJsonCell('text', ' [1, 2] ')).toBe(true)
    expect(isJsonCell('text', '{not json')).toBe(false)
    expect(isJsonCell('text', 'plain')).toBe(false)
    expect(isJsonCell('jsonb', null)).toBe(false)
    expect(isJsonCell('integer', 5)).toBe(false)
  })
})

describe('prettyJson', () => {
  it('indents valid JSON with two spaces', () => {
    expect(prettyJson('{"a":[1,{"b":null}]}')).toEqual({ ok: true, text: '{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ]\n}' })
  })
  it('returns invalid text unchanged with the parser message', () => {
    const out = prettyJson('{oops')
    expect(out.ok).toBe(false)
    expect(out.text).toBe('{oops')
    expect(out.error).toBeTruthy()
  })
})

describe('jsonTokens', () => {
  it('tells keys from string values, and types apart', () => {
    expect(jsonTokens('{"a": "x", "n": -1.5e2, "t": true, "z": null}').filter((t) => t.type !== 'punct')).toEqual([
      { type: 'key', text: '"a"' },
      { type: 'string', text: '"x"' },
      { type: 'key', text: '"n"' },
      { type: 'number', text: '-1.5e2' },
      { type: 'key', text: '"t"' },
      { type: 'literal', text: 'true' },
      { type: 'key', text: '"z"' },
      { type: 'literal', text: 'null' }
    ])
  })
  it('keeps every character, so the text can be rebuilt', () => {
    const src = '{\n  "s": "a \\"q\\" b",\n  "l": [1, 2]\n}'
    expect(jsonTokens(src).map((t) => t.text).join('')).toBe(src)
  })
})
