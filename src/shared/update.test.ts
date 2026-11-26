import { describe, expect, it } from 'vitest'
import { newerRelease, parseVersion } from './update'

describe('parseVersion', () => {
  it('accepts plain and v-prefixed versions', () => {
    expect(parseVersion('0.2.0')).toEqual([0, 2, 0])
    expect(parseVersion('v10.0.3')).toEqual([10, 0, 3])
  })

  it('rejects pre-releases and garbage', () => {
    expect(parseVersion('v1.0.0-beta.1')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })
})

describe('newerRelease', () => {
  it('announces a newer tag with its release page', () => {
    expect(newerRelease('0.1.0', 'v0.2.0')).toEqual({ version: '0.2.0', url: 'https://github.com/loxt/tessera/releases/tag/v0.2.0' })
  })

  it('compares numerically, not as strings', () => {
    expect(newerRelease('0.9.0', 'v0.10.0')?.version).toBe('0.10.0')
    expect(newerRelease('0.10.0', 'v0.9.0')).toBeNull()
  })

  it('stays quiet for the same or an older version', () => {
    expect(newerRelease('0.2.0', 'v0.2.0')).toBeNull()
    expect(newerRelease('1.0.0', 'v0.9.9')).toBeNull()
  })

  it('ignores tags that are not plain versions', () => {
    expect(newerRelease('0.1.0', 'v0.2.0-rc.1')).toBeNull()
    expect(newerRelease('0.1.0', undefined)).toBeNull()
  })
})
