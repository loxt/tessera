import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipUncompressedSize } from './importFile'

/** A zip holding one empty-named entry whose central directory claims `size` uncompressed bytes. */
function fakeZip(size: number): Buffer {
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt32LE(size, 24)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(0, 16) // central directory at offset 0
  return Buffer.concat([cd, eocd])
}

describe('zipUncompressedSize', () => {
  it('adds up the entries of a real workbook', () => {
    const size = zipUncompressedSize(readFileSync(resolve(__dirname, '../../fixtures/import-sample.xlsx')))
    expect(size).toBeGreaterThan(1000)
    expect(size).toBeLessThan(1_000_000)
  })
  it('reads what a crafted directory claims, so a bomb is caught before inflating', () => {
    expect(zipUncompressedSize(fakeZip(1_000_000_000))).toBe(1_000_000_000)
  })
  it('rejects zip64 and things that are not zips', () => {
    expect(() => zipUncompressedSize(fakeZip(0xffffffff))).toThrow(/too large/)
    expect(() => zipUncompressedSize(Buffer.from('not a zip at all'))).toThrow(/not a valid/)
  })
})
