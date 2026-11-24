import { describe, expect, it } from 'vitest'
import { connectionAccent, ENVIRONMENTS, environmentLabel, isEnvironment, suggestReadOnly } from './environment'

describe('environment', () => {
  it('accepts only the known environments', () => {
    for (const env of ENVIRONMENTS) expect(isEnvironment(env)).toBe(true)
    expect(isEnvironment('prod')).toBe(false)
    expect(isEnvironment(undefined)).toBe(false)
    expect(isEnvironment(3)).toBe(false)
  })

  it('labels every environment', () => {
    expect(environmentLabel('local')).toBe('Local')
    expect(environmentLabel('staging')).toBe('Staging')
    expect(environmentLabel('production')).toBe('Production')
  })

  it('paints a connection with its environment color before its custom color', () => {
    expect(connectionAccent({ environment: 'production', color: '#3574f0' })).toBe('var(--env-production)')
    expect(connectionAccent({ environment: 'local' })).toBe('var(--env-local)')
  })

  it('falls back to the custom color, then to nothing', () => {
    expect(connectionAccent({ color: '#3574f0' })).toBe('#3574f0')
    expect(connectionAccent({})).toBeUndefined()
  })

  it('suggests read-only only when switching to production', () => {
    expect(suggestReadOnly('production', 'staging')).toBe(true)
    expect(suggestReadOnly('production', 'production')).toBe(false)
    expect(suggestReadOnly('staging', 'production')).toBe(false)
    expect(suggestReadOnly('production', undefined)).toBe(true)
  })
})
