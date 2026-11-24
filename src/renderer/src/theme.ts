import type { Theme } from '@shared/themes'
import { monaco } from './editor/monaco'

const strip = (hex: string) => hex.replace('#', '')

const CSS_VARS: [string, (t: Theme) => string][] = [
  ['--bg', (t) => t.ui.bg], ['--panel', (t) => t.ui.panel], ['--panel-2', (t) => t.ui.panel2], ['--chrome', (t) => t.ui.chrome],
  ['--border', (t) => t.ui.border], ['--border-soft', (t) => t.ui.borderSoft], ['--text', (t) => t.ui.text], ['--muted', (t) => t.ui.muted],
  ['--faint', (t) => t.ui.faint], ['--accent', (t) => t.ui.accent], ['--accent-text', (t) => t.ui.accentText], ['--accent-soft', (t) => t.ui.accentSoft],
  ['--hover', (t) => t.ui.hover], ['--selection', (t) => t.ui.selection], ['--danger', (t) => t.ui.danger], ['--success', (t) => t.ui.success],
  ['--warn', (t) => t.ui.warn], ['--null', (t) => t.ui.null], ['--input-bg', (t) => t.ui.inputBg], ['--cell-edited', (t) => t.ui.cellEdited],
  ['--cell-inserted', (t) => t.ui.cellInserted], ['--cell-deleted', (t) => t.ui.cellDeleted], ['--shadow', (t) => t.ui.shadow],
  // syntax colors outside Monaco (JSON viewer)
  // chart series: the first three slots of the validated categorical palette, stepped per mode
  ['--series-1', (t) => (t.dark ? '#3987e5' : '#2a78d6')], ['--series-2', (t) => (t.dark ? '#d95926' : '#eb6834')], ['--series-3', (t) => (t.dark ? '#199e70' : '#1baf7a')],
  ['--syn-key', (t) => t.syntax.type], ['--syn-string', (t) => t.syntax.string], ['--syn-number', (t) => t.syntax.number], ['--syn-keyword', (t) => t.syntax.keyword]
]

/**
 * Every token Monaco's SQL grammars emit, with the syntax color it takes. The grammars add a ".sql"
 * postfix, and the base vs/vs-dark themes color "string.sql" red and "predefined.sql" magenta, which
 * beat a bare "string" rule; so each token gets its ".sql" twin too.
 */
const SQL_TOKENS: [string, keyof Theme['syntax'], string?][] = [
  ['keyword', 'keyword'],
  ['keyword.block', 'keyword'],
  ['keyword.choice', 'keyword'],
  ['keyword.try', 'keyword'],
  ['keyword.catch', 'keyword'],
  ['string', 'string'],
  ['string.double', 'string'],
  ['number', 'number'],
  ['comment', 'comment', 'italic'],
  ['comment.quote', 'comment', 'italic'],
  ['predefined', 'func'],
  ['operator', 'operator'],
  ['identifier', 'identifier'],
  ['identifier.quote', 'identifier'],
  ['type', 'type'],
  // tokens from the Tessera tokenizer (editor/sqlLanguage.ts)
  ['table', 'table'],
  ['constant', 'constant', 'italic'],
  ['variable', 'param', 'bold'],
  ['function', 'func'],
  ['string.escape', 'operator'],
  ['string.dollar', 'string'],
  ['delimiter', 'operator'],
  ['delimiter.parenthesis', 'operator'],
  ['delimiter.square', 'operator']
]

/** Monaco theme derived from the same tokens, so the editor never clashes with the chrome. */
function defineMonacoTheme(t: Theme): void {
  const s = t.syntax
  monaco.editor.defineTheme(t.id, {
    base: t.dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: strip(s.identifier) },
      ...SQL_TOKENS.flatMap(([token, color, fontStyle]) =>
        [token, `${token}.sql`].map((name) => ({ token: name, foreground: strip(s[color]), ...(fontStyle ? { fontStyle } : {}) }))
      )
    ],
    colors: {
      'editor.background': t.ui.bg,
      'editor.foreground': s.identifier,
      'editor.lineHighlightBackground': t.editor.lineHighlight,
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': t.editor.selection,
      'editorCursor.foreground': t.editor.cursor,
      'editorLineNumber.foreground': t.editor.lineNumber,
      'editorLineNumber.activeForeground': t.editor.lineNumberActive,
      'editorGutter.background': t.ui.bg,
      'editorWidget.background': t.ui.panel,
      'editorWidget.border': t.ui.border,
      'editorSuggestWidget.background': t.ui.panel,
      'editorSuggestWidget.border': t.ui.border,
      'editorSuggestWidget.selectedBackground': t.ui.accentSoft,
      'editorSuggestWidget.selectedForeground': t.ui.text,
      'editorSuggestWidget.foreground': t.ui.text,
      'editorSuggestWidget.focusHighlightForeground': t.ui.accent,
      'editorSuggestWidget.highlightForeground': t.ui.accent,
      'editorHoverWidget.background': t.ui.panel,
      'input.background': t.ui.inputBg,
      focusBorder: t.ui.accent,
      'scrollbarSlider.background': t.ui.hover,
      'scrollbarSlider.hoverBackground': t.ui.selection,
      'editorBracketMatch.background': t.ui.accentSoft,
      'editorBracketMatch.border': '#00000000',
      'editorIndentGuide.background1': t.ui.borderSoft,
      'editorError.foreground': t.ui.danger
    }
  })
}

const defined = new Set<string>()

export function applyTheme(t: Theme): void {
  const root = document.documentElement
  for (const [name, get] of CSS_VARS) root.style.setProperty(name, get(t))
  for (const [k, v] of Object.entries(t.icons)) root.style.setProperty(`--i-${k}`, v)
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  root.dataset.theme = t.dark ? 'dark' : 'light'
  root.dataset.themeId = t.id
  if (!defined.has(t.id)) {
    defineMonacoTheme(t)
    defined.add(t.id)
  }
  monaco.editor.setTheme(t.id)
}
