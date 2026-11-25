// Small original icon set (16×16, currentColor unless a semantic tint is given).

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ICONS: Record<string, React.ReactNode> = {
  database: (
    <g {...S} stroke="var(--i-database)">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </g>
  ),
  schema: (
    <g {...S} stroke="var(--i-schema)">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.5 6h5M5.5 8h5M5.5 10h3" />
    </g>
  ),
  folder: <path {...S} stroke="var(--i-folder)" d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />,
  table: (
    <g {...S} stroke="var(--i-table)">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M6 6.5V13" />
    </g>
  ),
  view: (
    <g {...S} stroke="var(--i-view)">
      <rect x="2" y="3" width="12" height="10" rx="1.5" strokeDasharray="2 1.5" />
      <path d="M2 6.5h12" />
    </g>
  ),
  column: <rect x="3" y="6" width="10" height="4" rx="1" fill="var(--i-column)" />,
  key: (
    <g {...S} stroke="var(--i-key)">
      <circle cx="5.5" cy="8" r="2.5" />
      <path d="M8 8h6M12 8v2M10 8v1.5" />
    </g>
  ),
  fk: (
    <g {...S} stroke="var(--i-fk)">
      <circle cx="5.5" cy="8" r="2.5" />
      <path d="M8 8h6M12 8v2" />
    </g>
  ),
  index: <path {...S} stroke="var(--i-index)" d="M3 4h10M3 8h7M3 12h4" />,
  routine: (
    <text x="2" y="12" fontSize="10" fontStyle="italic" fontWeight="700" fill="var(--i-routine)">
      ƒx
    </text>
  ),
  sequence: (
    <text x="1" y="11.5" fontSize="7.5" fontWeight="700" fill="var(--i-sequence)">
      123
    </text>
  ),
  play: <path d="M5 3.5v9l7-4.5z" fill="var(--i-run)" />,
  playAll: <path d="M2.5 3.5v9l6-4.5zM8.5 3.5v9l6-4.5z" fill="var(--i-run)" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" fill="var(--i-stop)" />,
  plan: <path {...S} d="M3 3v4h4M5 7v5h4M3 3h2M9 12h4M7 7h3" />,
  commit: <path {...S} stroke="var(--i-run)" strokeWidth={1.8} d="M3 8.5l3 3 7-7" />,
  rollback: <path {...S} stroke="var(--i-stop)" d="M4 6h6a3 3 0 010 6H7M4 6l2.5-2.5M4 6l2.5 2.5" />,
  plus: <path {...S} d="M8 3v10M3 8h10" />,
  minus: <path {...S} d="M3 8h10" />,
  refresh: <path {...S} d="M13 8a5 5 0 11-1.5-3.5M13 3v2.5h-2.5" />,
  filter: <path {...S} d="M2.5 3.5h11l-4.2 5v4l-2.6 1v-5z" />,
  gear: (
    <g {...S}>
      <path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6" />
      <circle cx="10.5" cy="4.5" r="1.5" />
      <circle cx="5.5" cy="11.5" r="1.5" />
    </g>
  ),
  close: <path {...S} d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  chevronRight: <path {...S} d="M6 4l4 4-4 4" />,
  chevronDown: <path {...S} d="M4 6l4 4 4-4" />,
  chevronLeft: <path {...S} d="M10 4L6 8l4 4" />,
  first: <path {...S} d="M11 4L7 8l4 4M4.5 4v8" />,
  last: <path {...S} d="M5 4l4 4-4 4M11.5 4v8" />,
  search: (
    <g {...S}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </g>
  ),
  history: (
    <g {...S}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </g>
  ),
  export: <path {...S} d="M8 10V2.5M5 5.5l3-3 3 3M3 9v4h10V9" />,
  ddl: (
    <g {...S}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M6 8h4M6 10.5h4" />
    </g>
  ),
  console: (
    <g {...S}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M4.5 6.5L6.5 8l-2 1.5M8 10h3" />
    </g>
  ),
  disconnect: <path {...S} d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 01-7 0zM8 11v3" />,
  sidebar: (
    <g {...S}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </g>
  ),
  bell: <path {...S} d="M4 11V7a4 4 0 018 0v4l1 1H3zM6.5 13.5a1.5 1.5 0 003 0" />,
  sun: (
    <g {...S}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </g>
  ),
  moon: <path {...S} d="M12.5 10A5.5 5.5 0 016 3.5 5.5 5.5 0 1012.5 10z" />,
  edit: <path {...S} d="M3 13l.5-2.5L10.5 3.5l2 2-7 7zM9 5l2 2" />,
  copy: (
    <g {...S}>
      <rect x="5" y="5" width="8" height="8" rx="1.2" />
      <path d="M3 10.5V4a1 1 0 011-1h6.5" />
    </g>
  ),
  revert: <path {...S} d="M4 6h6a3 3 0 010 6H7M4 6l2.5-2.5M4 6l2.5 2.5" />,
  check: <path {...S} strokeWidth={1.8} d="M3.5 8.5l3 3 6-6.5" />,
  info: (
    <g {...S} strokeWidth={1.6}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.3V11M8 5v.01" />
    </g>
  ),
  alert: (
    <g {...S} strokeWidth={1.6}>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.5v3M8 11.3v.01" />
    </g>
  ),
  form: (
    <g {...S}>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </g>
  ),
  braces: <path {...S} d="M6 2.5c-1.3 0-2 .6-2 1.8v1.9c0 .9-.5 1.5-1.5 1.8 1 .3 1.5.9 1.5 1.8v1.9c0 1.2.7 1.8 2 1.8M10 2.5c1.3 0 2 .6 2 1.8v1.9c0 .9.5 1.5 1.5 1.8-1 .3-1.5.9-1.5 1.8v1.9c0 1.2-.7 1.8-2 1.8" />,
  // column type families (grid header)
  'type-number': <path {...S} d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M3 6h10.5M2.5 10h10.5" />,
  'type-text': <path {...S} d="M3 4h10M8 4v9.5M6 13.5h4" />,
  'type-bool': (
    <g {...S}>
      <rect x="1.5" y="4.5" width="13" height="7" rx="3.5" />
      <circle cx="11" cy="8" r="1.8" fill="currentColor" />
    </g>
  ),
  'type-date': (
    <g {...S}>
      <rect x="2" y="3.5" width="12" height="10" rx="1.5" />
      <path d="M2 7h12M5.5 2v3M10.5 2v3" />
    </g>
  ),
  'type-binary': <path {...S} d="M3 3.5v5M5.5 3.5h1.5v5H5.5zM9 3.5h1.5v5H9zM12.5 3.5v5M3 11h1.5v2.5M7 11v2.5M9.5 11h1.5v2.5H9.5zM13 11v2.5" />,
  diff: (
    <g {...S}>
      <rect x="2" y="2.5" width="5" height="11" rx="1.2" />
      <rect x="9" y="2.5" width="5" height="11" rx="1.2" />
      <path d="M3.5 6h2M10.5 6h2M11.5 5v2M10.5 10h2M3.5 10h2" />
    </g>
  ),
  chart: <path {...S} d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />,
  pin: <path {...S} d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" />,
  shield: <path {...S} d="M8 2 3 4v4c0 3 2.2 5.4 5 6 2.8-.6 5-3 5-6V4z" />,
  spark: (
    <g {...S} strokeWidth={1.4}>
      <path d="M7 2.5l1.2 3.3 3.3 1.2-3.3 1.2L7 11.5 5.8 8.2 2.5 7l3.3-1.2z" />
      <path d="M12.3 10.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
    </g>
  ),
  tessera: <path {...S} strokeWidth={1.6} d="M3 3h10v10H3zM3 6.5h10M3 9.5h10M6.5 3v10M9.5 3v10" />,
  upload: <path {...S} d="M8 12V3.5M5 6.5l3-3 3 3M3 13.5h10" />,
  eye: (
    <g {...S}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </g>
  )
}

export function Icon({ name, title }: { name: string; title?: string }) {
  return (
    <svg className="i" viewBox="0 0 16 16" aria-hidden={!title} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  )
}
