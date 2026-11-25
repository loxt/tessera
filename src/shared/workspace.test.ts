import { describe, expect, it } from 'vitest'
import { isWorkspaceName, workspaceFromArgv } from './workspace'

describe('workspaces', () => {
  it('accepts plain names', () => {
    for (const n of ['Work', 'personal', 'Cliente X', 'v1.2_test-env', 'Trabalho']) expect(isWorkspaceName(n)).toBe(true)
  })

  it('rejects names that are not a single safe folder', () => {
    for (const n of ['', '..', '.hidden', 'a/b', 'a\\b', ' padded ', 'x'.repeat(41)]) expect(isWorkspaceName(n)).toBe(false)
  })

  it('reads the workspace from argv and ignores invalid ones', () => {
    expect(workspaceFromArgv(['/app', '--workspace=Work'])).toBe('Work')
    expect(workspaceFromArgv(['/app', '--workspace=../etc'])).toBeUndefined()
    expect(workspaceFromArgv(['/app'])).toBeUndefined()
  })
})
