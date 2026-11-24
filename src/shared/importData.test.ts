import { describe, expect, it } from 'vitest'
import { autoMap, buildInserts, detectDelimiter, parseDelimited } from './importData'

describe('parseDelimited', () => {
  it('handles quotes, doubled quotes, separators and line breaks inside quotes', () => {
    const text = 'name,note\r\n"Ana, Jr.","said ""hi""\nand left"\nBruno,\n'
    expect(parseDelimited(text, ',')).toEqual([
      ['name', 'note'],
      ['Ana, Jr.', 'said "hi"\nand left'],
      ['Bruno', '']
    ])
  })
  it('drops a byte-order mark and blank trailing lines', () => {
    expect(parseDelimited('﻿a;b\n1;2\n\n', ';')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('detectDelimiter', () => {
  it('picks the separator that splits the first lines consistently', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1,5;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('single')).toBe(',')
  })
})

const columns = [
  { name: 'id', type: 'integer', nullable: false, default: "nextval('s')", autoIncrement: true },
  { name: 'name', type: 'text', nullable: false, default: null, autoIncrement: false },
  { name: 'email', type: 'varchar(255)', nullable: true, default: null, autoIncrement: false },
  { name: 'created_at', type: 'timestamp', nullable: false, default: 'now()', autoIncrement: false }
]

describe('autoMap', () => {
  it('matches headers to columns ignoring case, spaces and punctuation', () => {
    expect(autoMap(['Name', 'E-mail', 'Created At', 'extra'], columns)).toEqual({ id: null, name: 0, email: 1, created_at: 2 })
  })
})

describe('buildInserts', () => {
  const rows = [
    ['Ana', 'ana@x.com'],
    ['', 'nobody@x.com'],
    ['Bruno', '']
  ]
  it('maps rows to column values, empty cells as NULL', () => {
    const r = buildInserts(rows, { id: null, name: 0, email: 1, created_at: null }, columns, true)
    expect(r.inserts[0]).toEqual({ name: 'Ana', email: 'ana@x.com' })
    expect(r.inserts[2]).toEqual({ name: 'Bruno', email: null })
  })
  it('reports a required value that is missing, with the row number', () => {
    const r = buildInserts(rows, { id: null, name: 0, email: 1, created_at: null }, columns, true)
    expect(r.problems).toEqual(['Row 2: name is required'])
  })
  it('reports a required column left unmapped', () => {
    const r = buildInserts(rows, { id: null, name: null, email: 1, created_at: null }, columns, true)
    expect(r.problems[0]).toBe('name is required and has no source column')
  })
  it('keeps empty strings when asked', () => {
    expect(buildInserts([['Bruno', '']], { id: null, name: 0, email: 1, created_at: null }, columns, false).inserts[0]).toEqual({ name: 'Bruno', email: '' })
  })
})
