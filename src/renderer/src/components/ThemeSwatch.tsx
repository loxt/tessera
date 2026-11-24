import type { Theme } from '@shared/themes'

/** A miniature of the theme: chrome strip and a few lines of SQL in the theme's own colors. */
export function ThemeSwatch({ theme, size = 'card' }: { theme: Theme; size?: 'card' | 'row' }) {
  const t = theme
  if (size === 'row') {
    return (
      <span className="swatch-row" style={{ background: t.ui.bg, borderColor: t.ui.border }}>
        {[t.ui.accent, t.syntax.keyword, t.syntax.string, t.syntax.number, t.syntax.func].map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
      </span>
    )
  }
  return (
    <span className="swatch-card" style={{ background: t.ui.bg, borderColor: t.ui.border }} aria-hidden>
      <span className="sc-chrome" style={{ background: t.ui.chrome, borderColor: t.ui.border }}>
        <i style={{ background: t.ui.accent }} />
      </span>
      <span className="sc-code" style={{ color: t.syntax.identifier }}>
        <span style={{ color: t.editor.lineNumber }}>1 </span>
        <span style={{ color: t.syntax.keyword }}>select</span> <span style={{ color: t.syntax.func }}>count</span>(*)
        <br />
        <span style={{ color: t.editor.lineNumber }}>2 </span>
        <span style={{ color: t.syntax.keyword }}>from</span> orders <span style={{ color: t.syntax.keyword }}>where</span>
        <br />
        <span style={{ color: t.editor.lineNumber }}>3 </span>
        &nbsp;status = <span style={{ color: t.syntax.string }}>'paid'</span> <span style={{ color: t.syntax.number }}>42</span>
      </span>
    </span>
  )
}
