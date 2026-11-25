import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { isWorkspaceName, WORKSPACE_FLAG, workspaceFromArgv } from '@shared/workspace'

/** The workspace this process runs in; undefined is the default one (the usual app data folder). */
export const currentWorkspace = workspaceFromArgv(process.argv)

const root = () => join(app.getPath('appData'), 'Tessera Workspaces')

/** Each workspace is a whole Electron profile: data sources, passwords, consoles, history, prefs. */
export const workspaceDir = (name: string) => join(root(), name)

export function listWorkspaces(): string[] {
  try {
    return readdirSync(root(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && isWorkspaceName(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return [] // no workspace created yet
  }
}

/** Restarts Tessera in another workspace (undefined: the default one), creating it if needed. */
export function switchWorkspace(name: string | undefined): void {
  if (name !== undefined && !isWorkspaceName(name)) throw new Error('Use up to 40 letters, digits, spaces, dots, dashes or underscores.')
  if (name === currentWorkspace) return
  if (name) mkdirSync(workspaceDir(name), { recursive: true, mode: 0o700 })
  const args = [...process.argv.slice(1).filter((a) => !a.startsWith(WORKSPACE_FLAG)), ...(name ? [WORKSPACE_FLAG + name] : [])]
  app.relaunch({ args })
  app.quit() // the normal quit path: sessions close, the window saves its state
}
