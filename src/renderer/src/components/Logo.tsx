/** The Tessera mark: one gold azulejo tile. Gold stays gold in every theme; it is the brand, not a token. */
export const LOGO_GOLD = '#E6BE5A'
export const LOGO_PETALS =
  'M14 5c2.5 3 2.5 6 0 9-2.5-3-2.5-6 0-9zM14 14c2.5 3 2.5 6 0 9-2.5-3-2.5-6 0-9zM5 14c3-2.5 6-2.5 9 0-3 2.5-6 2.5-9 0zM14 14c3-2.5 6-2.5 9 0-3 2.5-6 2.5-9 0z'

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="1" y="1" width="26" height="26" rx="6" fill={LOGO_GOLD} />
      <path d={LOGO_PETALS} fill="#0E0F11" />
    </svg>
  )
}
