import { describe, expect, test } from 'vitest'
import { parseConnectionUrl } from './url'

describe('parseConnectionUrl', () => {
  test('postgres URL with credentials and sslmode', () => {
    expect(parseConnectionUrl('postgresql://bob:s%40cret@db.local:6543/shop?sslmode=require')).toEqual({
      engine: 'postgres', host: 'db.local', port: 6543, user: 'bob', password: 's@cret', database: 'shop', ssl: 'require'
    })
  })
  test('JDBC URLs', () => {
    expect(parseConnectionUrl('jdbc:mysql://localhost/app')).toEqual({ engine: 'mysql', host: 'localhost', port: 3306, database: 'app' })
    expect(parseConnectionUrl('jdbc:sqlite:/tmp/a.db')).toEqual({ engine: 'sqlite', file: '/tmp/a.db' })
  })
  test('bare SQLite file path', () => {
    expect(parseConnectionUrl('/Users/me/data.sqlite3')).toEqual({ engine: 'sqlite', file: '/Users/me/data.sqlite3' })
  })
  test('certificate-verifying sslmodes are never downgraded', () => {
    expect(parseConnectionUrl('postgres://h/db?sslmode=verify-ca').ssl).toBe('verify-full')
    expect(parseConnectionUrl('postgres://h/db?sslmode=verify-full').ssl).toBe('verify-full')
  })
  test('rejects unknown schemes', () => {
    expect(() => parseConnectionUrl('redis://x')).toThrow(/unsupported/i)
  })
})
