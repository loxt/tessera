import { environmentLabel, type Environment } from '@shared/environment'

export function EnvBadge({ env }: { env: Environment }) {
  return (
    <span className="env-badge" style={{ '--env': `var(--env-${env})` } as React.CSSProperties}>
      {environmentLabel(env)}
    </span>
  )
}
