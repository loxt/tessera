// Where a data source lives. The environment drives its color everywhere (explorer, tabs, status
// bar) so production is unmistakable; the CSS tokens behind it come from the active theme.

export type Environment = 'local' | 'staging' | 'production'

export const ENVIRONMENTS: readonly Environment[] = ['local', 'staging', 'production']

const LABEL: Record<Environment, string> = { local: 'Local', staging: 'Staging', production: 'Production' }

export const isEnvironment = (v: unknown): v is Environment => typeof v === 'string' && (ENVIRONMENTS as readonly string[]).includes(v)

export const environmentLabel = (env: Environment): string => LABEL[env]

/** CSS color for a data source: its environment wins over the free-form color. */
export function connectionAccent(p: { environment?: Environment; color?: string }): string | undefined {
  if (p.environment) return `var(--env-${p.environment})`
  return p.color || undefined
}

/** Moving a data source into production turns read-only on by default; the user can still turn it off. */
export const suggestReadOnly = (next: Environment | undefined, previous: Environment | undefined): boolean =>
  next === 'production' && previous !== 'production'
