// Editor font limits shared by the prefs sanitizer (main) and the settings / font-size actions (renderer).
// Defaults follow DataGrip: JetBrains Mono 13 with line height 1.2.

export const FONT_SIZE_DEFAULT = 13
export const LINE_HEIGHT_DEFAULT = 1.2
const FONT_MIN = 8
const FONT_MAX = 40
const LINE_MIN = 1
const LINE_MAX = 2.5

export const clampFontSize = (n: number): number => (Number.isFinite(n) ? Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n))) : FONT_SIZE_DEFAULT)

export const stepFontSize = (size: number, dir: 1 | -1): number => clampFontSize(size + dir)

export const clampLineHeight = (n: number): number =>
  Number.isFinite(n) ? Math.round(Math.min(LINE_MAX, Math.max(LINE_MIN, n)) * 10) / 10 : LINE_HEIGHT_DEFAULT
