// Color themes. Each theme defines every token the app paints with: UI chrome, the SQL
// editor (Monaco), explorer icons and data-grid edit states.
// Catppuccin palettes: https://github.com/catppuccin/catppuccin (MIT), mapped per its style guide.
// Hardhacker palette: https://github.com/hardhackerlabs/themes (MIT).

export interface Theme {
  id: string
  name: string
  family: string
  dark: boolean
  /** light/dark counterpart, used by "Toggle Light/Dark Theme" */
  pair: string
  ui: {
    bg: string
    panel: string
    panel2: string
    chrome: string
    border: string
    borderSoft: string
    text: string
    muted: string
    faint: string
    accent: string
    accentText: string
    accentSoft: string
    hover: string
    selection: string
    danger: string
    success: string
    warn: string
    null: string
    inputBg: string
    cellEdited: string
    cellInserted: string
    cellDeleted: string
    shadow: string
  }
  icons: Record<'database' | 'schema' | 'folder' | 'table' | 'view' | 'column' | 'key' | 'fk' | 'index' | 'routine' | 'sequence' | 'run' | 'stop', string>
  syntax: {
    keyword: string; string: string; number: string; comment: string; func: string; operator: string; identifier: string; type: string
    /** table names after FROM / JOIN / INTO / UPDATE … */
    table: string
    /** bind parameters: :name, $1, ? */
    param: string
    /** NULL, TRUE, FALSE, CURRENT_DATE … */
    constant: string
  }
  editor: { lineHighlight: string; lineNumber: string; lineNumberActive: string; selection: string; cursor: string }
}

/** "#rrggbb" + alpha (0..1) → "#rrggbbaa" */
const a = (hex: string, alpha: number) => hex + Math.round(alpha * 255).toString(16).padStart(2, '0')

interface Catppuccin {
  rosewater: string; pink: string; mauve: string; red: string; peach: string; yellow: string; green: string; teal: string; sky: string
  sapphire: string; blue: string; lavender: string; text: string; subtext0: string; overlay2: string; overlay1: string; overlay0: string
  surface0: string; base: string; mantle: string; crust: string
}

const MOCHA: Catppuccin = {
  rosewater: '#f5e0dc', pink: '#f5c2e7', mauve: '#cba6f7', red: '#f38ba8', peach: '#fab387', yellow: '#f9e2af', green: '#a6e3a1', teal: '#94e2d5',
  sky: '#89dceb', sapphire: '#74c7ec', blue: '#89b4fa', lavender: '#b4befe', text: '#cdd6f4', subtext0: '#a6adc8', overlay2: '#9399b2',
  overlay1: '#7f849c', overlay0: '#6c7086', surface0: '#313244', base: '#1e1e2e', mantle: '#181825', crust: '#11111b'
}
const MACCHIATO: Catppuccin = {
  rosewater: '#f4dbd6', pink: '#f5bde6', mauve: '#c6a0f6', red: '#ed8796', peach: '#f5a97f', yellow: '#eed49f', green: '#a6da95', teal: '#8bd5ca',
  sky: '#91d7e3', sapphire: '#7dc4e4', blue: '#8aadf4', lavender: '#b7bdf8', text: '#cad3f5', subtext0: '#a5adcb', overlay2: '#939ab7',
  overlay1: '#8087a2', overlay0: '#6e738d', surface0: '#363a4f', base: '#24273a', mantle: '#1e2030', crust: '#181926'
}
const FRAPPE: Catppuccin = {
  rosewater: '#f2d5cf', pink: '#f4b8e4', mauve: '#ca9ee6', red: '#e78284', peach: '#ef9f76', yellow: '#e5c890', green: '#a6d189', teal: '#81c8be',
  sky: '#99d1db', sapphire: '#85c1dc', blue: '#8caaee', lavender: '#babbf1', text: '#c6d0f5', subtext0: '#a5adce', overlay2: '#949cbb',
  overlay1: '#838ba7', overlay0: '#737994', surface0: '#414559', base: '#303446', mantle: '#292c3c', crust: '#232634'
}
const LATTE: Catppuccin = {
  rosewater: '#dc8a78', pink: '#ea76cb', mauve: '#8839ef', red: '#d20f39', peach: '#fe640b', yellow: '#df8e1d', green: '#40a02b', teal: '#179299',
  sky: '#04a5e5', sapphire: '#209fb5', blue: '#1e66f5', lavender: '#7287fd', text: '#4c4f69', subtext0: '#6c6f85', overlay2: '#7c7f93',
  overlay1: '#8c8fa1', overlay0: '#9ca0b0', surface0: '#ccd0da', base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8'
}

function catppuccin(id: string, name: string, c: Catppuccin, dark: boolean, pair: string): Theme {
  return {
    id, name, family: 'Catppuccin', dark, pair,
    ui: {
      bg: c.base, panel: c.mantle, panel2: c.mantle, chrome: c.crust, border: c.surface0, borderSoft: dark ? c.surface0 : c.crust,
      text: c.text, muted: c.subtext0, faint: c.overlay0, accent: c.mauve, accentText: dark ? c.crust : c.base, accentSoft: a(c.mauve, dark ? 0.22 : 0.16),
      hover: a(c.overlay2, 0.14), selection: a(c.overlay2, dark ? 0.28 : 0.24), danger: c.red, success: c.green, warn: c.yellow,
      null: c.overlay1, inputBg: dark ? c.crust : '#ffffff', cellEdited: a(c.blue, 0.2), cellInserted: a(c.green, 0.2), cellDeleted: a(c.red, 0.2),
      shadow: dark ? '0 12px 36px rgba(0,0,0,.5)' : '0 12px 36px rgba(76,79,105,.18)'
    },
    icons: {
      database: c.blue, schema: c.mauve, folder: c.overlay2, table: c.sapphire, view: c.teal, column: c.overlay1, key: c.yellow, fk: c.blue,
      index: c.pink, routine: c.peach, sequence: c.green, run: c.green, stop: c.red
    },
    syntax: {
      keyword: c.mauve, string: c.green, number: c.peach, comment: c.overlay2, func: c.blue, operator: c.sky, identifier: c.text, type: c.yellow,
      table: c.sapphire, param: c.pink, constant: c.peach
    },
    editor: { lineHighlight: a(c.surface0, dark ? 0.55 : 0.5), lineNumber: c.overlay0, lineNumberActive: c.lavender, selection: a(c.overlay2, 0.3), cursor: c.rosewater }
  }
}

const HH = { bg: '#282433', deep: '#211e2b', deeper: '#1b1824', line: '#3f3951', fg: '#eee9fc', comment: '#938aad', red: '#e965a5', green: '#b1f2a7', yellow: '#ebde76', blue: '#b1baf4', purple: '#e192ef', cyan: '#b3f4f3' }

const hardhacker: Theme = {
  id: 'hardhacker', name: 'Hardhacker', family: 'Hardhacker', dark: true, pair: 'catppuccin-latte',
  ui: {
    bg: HH.bg, panel: HH.deep, panel2: HH.deep, chrome: HH.deeper, border: HH.line, borderSoft: '#332e42', text: HH.fg, muted: HH.comment,
    faint: '#6c6585', accent: HH.red, accentText: HH.deeper, accentSoft: a(HH.red, 0.22), hover: a(HH.line, 0.7), selection: a(HH.purple, 0.22),
    danger: HH.red, success: HH.green, warn: HH.yellow, null: HH.comment, inputBg: HH.deeper, cellEdited: a(HH.blue, 0.22), cellInserted: a(HH.green, 0.2),
    cellDeleted: a(HH.red, 0.22), shadow: '0 12px 36px rgba(0,0,0,.55)'
  },
  icons: {
    database: HH.blue, schema: HH.purple, folder: HH.comment, table: HH.cyan, view: HH.green, column: HH.comment, key: HH.yellow, fk: HH.blue,
    index: HH.purple, routine: HH.red, sequence: HH.green, run: HH.green, stop: HH.red
  },
  syntax: {
    keyword: HH.red, string: HH.green, number: HH.yellow, comment: HH.comment, func: HH.blue, operator: HH.cyan, identifier: HH.fg, type: HH.purple,
    table: HH.cyan, param: HH.purple, constant: HH.yellow
  },
  editor: { lineHighlight: '#312c3f', lineNumber: '#5d5672', lineNumberActive: HH.purple, selection: a(HH.purple, 0.25), cursor: HH.red }
}

// Tessera's own themes: graphite stone with a gold accent (the azulejo mark), and its paper counterpart.
const GOLD = '#E6BE5A'

const tesseraGraphite: Theme = {
  id: 'tessera-graphite', name: 'Tessera Graphite', family: 'Tessera', dark: true, pair: 'tessera-paper',
  ui: {
    bg: '#0E0F11', panel: '#121417', panel2: '#15171A', chrome: '#0B0C0E', border: '#25292E', borderSoft: '#1C1F23', text: '#ECEAE4', muted: '#A3A39E',
    faint: '#6F7270', accent: GOLD, accentText: '#1A1505', accentSoft: a(GOLD, 0.16), hover: '#1F2226', selection: '#2A2618', danger: '#FF6369',
    success: '#5FD39A', warn: '#F4A36B', null: '#7E807F', inputBg: '#0E0F11', cellEdited: '#3A3016', cellInserted: '#15382A', cellDeleted: '#401A1D',
    shadow: '0 18px 50px rgba(0,0,0,.6)'
  },
  icons: {
    database: '#9CC3FF', schema: '#C9B8FF', folder: '#8C8E8C', table: '#79C7D9', view: '#7FE0B4', column: '#A3A39E', key: GOLD, fk: '#9CC3FF',
    index: '#F2A6C8', routine: '#F4A36B', sequence: '#8FD694', run: '#5FD39A', stop: '#FF6369'
  },
  // gold is the UI accent only; in code it reads heavy, so the editor gets its own cool palette
  syntax: {
    keyword: '#B9A4FF', string: '#A8D98B', number: '#F7A86B', comment: '#6F7472', func: '#7EB6FF', operator: '#A9ACB0', identifier: '#DAD7CF',
    type: '#F2A6C8', table: '#6FD3C7', param: '#FF9CAC', constant: '#F7A86B'
  },
  editor: { lineHighlight: '#15171A', lineNumber: '#4A4D4C', lineNumberActive: '#C9C7C1', selection: '#2C3342', cursor: '#ECEAE4' }
}

const tesseraPaper: Theme = {
  id: 'tessera-paper', name: 'Tessera Paper', family: 'Tessera', dark: false, pair: 'tessera-graphite',
  ui: {
    bg: '#FBFAF7', panel: '#F4F3EF', panel2: '#F0EEE9', chrome: '#ECEAE4', border: '#DAD7CE', borderSoft: '#E6E3DC', text: '#1B1C1E', muted: '#5C5E61',
    faint: '#9A9C9F', accent: '#8A6510', accentText: '#FFFFFF', accentSoft: a('#C9A033', 0.2), hover: '#E9E6DF', selection: '#F1E6C4', danger: '#C4373D',
    success: '#2E8A57', warn: '#B5651D', null: '#8C8E90', inputBg: '#FFFFFF', cellEdited: '#F6E9C2', cellInserted: '#D9F0E1', cellDeleted: '#F7D9DA',
    shadow: '0 14px 40px rgba(27,28,30,.16)'
  },
  icons: {
    database: '#2F5BEA', schema: '#6B4FC7', folder: '#7A7C80', table: '#1F7A99', view: '#2E8A6A', column: '#6C6E72', key: '#8A6510', fk: '#2F5BEA',
    index: '#B0407E', routine: '#B5651D', sequence: '#3E8A3B', run: '#2E8A57', stop: '#C4373D'
  },
  syntax: {
    keyword: '#6A3FC8', string: '#2F7D32', number: '#B5501D', comment: '#8C8E90', func: '#1F5FC9', operator: '#4A4C50', identifier: '#1B1C1E',
    type: '#B0407E', table: '#0F7C80', param: '#C23B5A', constant: '#B5501D'
  },
  editor: { lineHighlight: '#F4F1E8', lineNumber: '#B8B9B6', lineNumberActive: '#4A4C50', selection: '#D6DDF0', cursor: '#1B1C1E' }
}

export const THEMES: Theme[] = [
  tesseraGraphite,
  tesseraPaper,
  catppuccin('catppuccin-mocha', 'Catppuccin Mocha', MOCHA, true, 'catppuccin-latte'),
  catppuccin('catppuccin-macchiato', 'Catppuccin Macchiato', MACCHIATO, true, 'catppuccin-latte'),
  catppuccin('catppuccin-frappe', 'Catppuccin Frappé', FRAPPE, true, 'catppuccin-latte'),
  catppuccin('catppuccin-latte', 'Catppuccin Latte', LATTE, false, 'catppuccin-mocha'),
  hardhacker
]

export const THEME_IDS = ['system', ...THEMES.map((t) => t.id)]
export const themeById = (id: string) => THEMES.find((t) => t.id === id)

/** Ids saved by older builds (before themes, and before the rename from Lattice) → current ids. */
export const LEGACY_THEME_IDS: Record<string, string> = {
  dark: 'tessera-graphite',
  light: 'tessera-paper',
  'lattice-dark': 'tessera-graphite',
  'lattice-light': 'tessera-paper'
}

/** "system" follows macOS. */
export function resolveThemeId(pref: string, systemDark: boolean): string {
  const id = LEGACY_THEME_IDS[pref] ?? pref
  if (themeById(id)) return id
  return systemDark ? 'tessera-graphite' : 'tessera-paper'
}
