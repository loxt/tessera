import { describe, expect, test } from 'vitest'
import type { CompletionMetadata } from '@shared/model'
import { setSchemaHidden, visibleMetadata } from './schemas'

describe('setSchemaHidden', () => {
  test('hides a schema, keeping the list sorted and unique', () => {
    expect(setSchemaHidden(undefined, 'staging', true)).toEqual(['staging'])
    expect(setSchemaHidden(['staging'], 'audit', true)).toEqual(['audit', 'staging'])
    expect(setSchemaHidden(['audit'], 'audit', true)).toEqual(['audit'])
  })

  test('unhiding the last schema clears the list', () => {
    expect(setSchemaHidden(['audit', 'staging'], 'audit', false)).toEqual(['staging'])
    expect(setSchemaHidden(['audit'], 'audit', false)).toBeUndefined()
    expect(setSchemaHidden(undefined, 'audit', false)).toBeUndefined()
  })

  test('does not mutate the input', () => {
    const list = ['b']
    setSchemaHidden(list, 'a', true)
    expect(list).toEqual(['b'])
  })
})

describe('visibleMetadata', () => {
  const md: CompletionMetadata = {
    defaultSchema: 'public',
    schemas: ['public', 'staging', 'supplier'],
    tables: [
      { schema: 'public', name: 'orders', kind: 'table', columns: ['id'] },
      { schema: 'staging', name: 'orders_raw', kind: 'table', columns: ['id'] },
      { schema: 'supplier', name: 'sku_supplier', kind: 'table', columns: ['sku'] }
    ]
  }

  test('drops hidden schemas and their tables', () => {
    const v = visibleMetadata(md, ['staging'])
    expect(v.schemas).toEqual(['public', 'supplier'])
    expect(v.tables.map((t) => t.name)).toEqual(['orders', 'sku_supplier'])
    expect(v.defaultSchema).toBe('public')
  })

  test('returns the same object when nothing is hidden', () => {
    expect(visibleMetadata(md, undefined)).toBe(md)
    expect(visibleMetadata(md, [])).toBe(md)
  })
})
