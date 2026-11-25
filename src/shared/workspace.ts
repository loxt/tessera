/** Command-line flag that starts Tessera in a named workspace (its own data folder). */
export const WORKSPACE_FLAG = '--workspace='

const VALID = /^[\p{L}\p{N} ._-]{1,40}$/u

/** A workspace name becomes a folder name: no separators, no leading dot ("..", hidden folders). */
export const isWorkspaceName = (name: string): boolean => VALID.test(name) && !name.startsWith('.') && name.trim() === name

/** The workspace named on the command line, if any (invalid names are ignored). */
export function workspaceFromArgv(argv: readonly string[]): string | undefined {
  const name = argv.find((a) => a.startsWith(WORKSPACE_FLAG))?.slice(WORKSPACE_FLAG.length)
  return name && isWorkspaceName(name) ? name : undefined
}
