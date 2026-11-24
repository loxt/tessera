// Keymap core: canonical accelerators, IntelliJ/DataGrip keymap resolution, context-aware lookup.
// Canonical accelerator = Electron syntax with fixed modifier order "Ctrl+Alt+Shift+Cmd+Key".
import { ACTIONS } from './actions'

export type Scope = 'global' | 'editor' | 'grid'
export type KeyContext = 'editor' | 'grid' | 'none'
export type Bindings = Record<string, string[]>

/** Persisted keymap: overrides on top of the built-in defaults, plus where they came from. */
export interface KeymapState {
  source?: string
  bindings: Bindings
}

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Cmd'] as const

const MOD_ALIASES: Record<string, string> = {
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', altgraph: 'Alt', shift: 'Shift',
  cmd: 'Cmd', command: 'Cmd', meta: 'Cmd', super: 'Cmd'
}

const build = (mods: Set<string>, key: string) => [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+')

/** Normalizes an Electron-style accelerator ("CmdOrCtrl+Shift+L") to canonical form. */
export function canonicalAccel(accel: string, mac: boolean): string {
  const parts = accel.split('+')
  const key = parts.pop()!
  const mods = new Set<string>()
  for (const p of parts) {
    const low = p.toLowerCase()
    if (low === 'cmdorctrl' || low === 'commandorcontrol') mods.add(mac ? 'Cmd' : 'Ctrl')
    else if (MOD_ALIASES[low]) mods.add(MOD_ALIASES[low])
  }
  return build(mods, key.length === 1 ? key.toUpperCase() : key)
}

const IDEA_KEYS: Record<string, string> = {
  ENTER: 'Enter', BACK_SPACE: 'Backspace', DELETE: 'Delete', ESCAPE: 'Escape', TAB: 'Tab', SPACE: 'Space',
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', HOME: 'Home', END: 'End', PAGE_UP: 'PageUp', PAGE_DOWN: 'PageDown',
  INSERT: 'Insert', SLASH: '/', BACK_SLASH: '\\', OPEN_BRACKET: '[', CLOSE_BRACKET: ']', COMMA: ',', PERIOD: '.',
  SEMICOLON: ';', QUOTE: "'", BACK_QUOTE: '`', MINUS: '-', EQUALS: '=', ADD: 'numadd', SUBTRACT: 'numsub',
  MULTIPLY: 'nummult', DIVIDE: 'numdiv', DECIMAL: 'numdec'
}

function ideaKey(token: string): string | null {
  const up = token.toUpperCase()
  if (/^[A-Z0-9]$/.test(up)) return up
  if (/^F([1-9]|1\d|2[0-4])$/.test(up)) return up
  if (/^NUMPAD\d$/.test(up)) return 'num' + up.slice(6)
  return IDEA_KEYS[up] ?? null
}

/**
 * Converts an IntelliJ keystroke ("meta shift L", "control alt ENTER") to canonical form.
 * `swapCtrlMeta`: the macOS keymap inherits `$default` with Ctrl and Cmd exchanged.
 */
export function parseIdeaKeystroke(stroke: string, swapCtrlMeta = false): string | null {
  const tokens = stroke.trim().split(/\s+/).filter((t) => t !== 'pressed' && t !== 'released')
  const key = ideaKey(tokens.pop() ?? '')
  if (!key) return null
  const mods = new Set<string>()
  for (const t of tokens) {
    let m = MOD_ALIASES[t.toLowerCase()]
    if (!m) return null
    if (swapCtrlMeta && (m === 'Ctrl' || m === 'Cmd')) m = m === 'Ctrl' ? 'Cmd' : 'Ctrl'
    mods.add(m)
  }
  return build(mods, key)
}

const CODE_KEYS: Record<string, string> = {
  Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', Tab: 'Tab', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp',
  PageDown: 'PageDown', Insert: 'Insert', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Comma: ',',
  Period: '.', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=', NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
}

interface KeyLike {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Canonical accelerator for a key event, by physical key (⌥L stays "Alt+L", not "¬"). */
export function eventToAccel(e: KeyLike): string | null {
  let key: string | undefined
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^Numpad\d$/.test(e.code)) key = 'num' + e.code.slice(6)
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code
  else key = CODE_KEYS[e.code]
  if (!key) return null
  const mods = new Set<string>()
  if (e.ctrlKey) mods.add('Ctrl')
  if (e.altKey) mods.add('Alt')
  if (e.shiftKey) mods.add('Shift')
  if (e.metaKey) mods.add('Cmd')
  return build(mods, key)
}

const MAC_SYMBOLS: Record<string, string> = {
  Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘', Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥',
  Space: 'Space', Up: '↑', Down: '↓', Left: '←', Right: '→', PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘'
}

export function accelLabel(accel: string | undefined, mac = true): string {
  if (!accel) return ''
  if (accel === 'Shift+Shift') return '⇧⇧'
  const parts = accel.split('+')
  return mac ? parts.map((p) => MAC_SYMBOLS[p] ?? p).join('') : parts.join('+')
}

// ---------- IntelliJ keymap resolution ----------

export interface IdeaKeymap {
  parent?: string
  /** action id → keystrokes; an empty list means "shortcut removed" in that keymap */
  actions: Record<string, string[]>
}

const MAC_DERIVED = new Set(['Mac OS X 10.5+', 'Mac OS X'])

/**
 * Effective shortcuts of `active`, following the parent chain the way the IDE does:
 * a keymap's own entry for an action wins (even if empty), then shortcuts that plugins
 * declare for that keymap, then the parent. Actions with `use-shortcut-of` borrow the
 * other action's shortcuts when they have none of their own.
 */
export function resolveIdeaKeymap(
  keymaps: Record<string, IdeaKeymap>,
  pluginShortcuts: Record<string, Record<string, string[]>>,
  useShortcutOf: Record<string, string>,
  active: string,
  mac: boolean
): Map<string, string[]> {
  const chain: string[] = []
  for (let name: string | undefined = active; name && !chain.includes(name); name = keymaps[name]?.parent) chain.push(name)
  const swapDefault = mac && chain.some((n) => MAC_DERIVED.has(n))
  const parse = (strokes: string[], keymapName: string) =>
    [...new Set(strokes.map((s) => parseIdeaKeystroke(s, swapDefault && keymapName === '$default')).filter((s): s is string => !!s))]

  const lookup = (id: string): string[] | undefined => {
    for (const name of chain) {
      const own = keymaps[name]?.actions[id]
      if (own) return parse(own, name)
      const declared = pluginShortcuts[name]?.[id]
      if (declared) return parse(declared, name)
    }
    return undefined
  }

  const ids = new Set<string>(Object.keys(useShortcutOf))
  for (const name of chain) {
    for (const id of Object.keys(keymaps[name]?.actions ?? {})) ids.add(id)
    for (const id of Object.keys(pluginShortcuts[name] ?? {})) ids.add(id)
  }
  const out = new Map<string, string[]>()
  for (const id of ids) {
    let r = lookup(id)
    if (r === undefined && useShortcutOf[id]) r = lookup(useShortcutOf[id])
    if (r !== undefined) out.set(id, r)
  }
  return out
}

// ---------- Tessera keymap ----------

export const SCOPES: Record<string, Scope> = Object.fromEntries(ACTIONS.map((a) => [a.id, a.scope ?? 'global']))

export function defaultBindings(mac: boolean): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, a.accel && a.accel !== 'Shift+Shift' ? [canonicalAccel(a.accel, mac)] : []]))
}

export function effectiveBindings(state: KeymapState | undefined, mac: boolean): Bindings {
  return withFallbacks({ ...defaultBindings(mac), ...(state?.bindings ?? {}) }, mac)
}

/**
 * Adds each action's fallback shortcut (⌥Space for completion: macOS takes ⌃Space for switching
 * input sources) unless the keymap already gives that key to something else.
 */
function withFallbacks(bindings: Bindings, mac: boolean): Bindings {
  return ACTIONS.reduce((out, a) => {
    if (!a.fallback) return out
    const accel = canonicalAccel(a.fallback, mac)
    const current = out[a.id] ?? []
    if (current.includes(accel) || findConflicts(out, SCOPES, a.id, accel).length) return out
    return { ...out, [a.id]: [...current, accel] }
  }, bindings)
}

/**
 * Maps resolved DataGrip shortcuts onto Tessera actions (via each action's `dg` ids).
 * Actions DataGrip doesn't bind keep their Tessera default unless that default now collides
 * with an imported shortcut — the user's keymap always wins.
 */
export function bindingsFromIdea(resolved: Map<string, string[]>, mac: boolean): Bindings {
  const imported: Bindings = {}
  for (const a of ACTIONS) {
    const known = (a.dg ?? []).filter((id) => resolved.has(id))
    if (known.length) imported[a.id] = [...new Set(known.flatMap((id) => resolved.get(id)!))]
  }
  const defaults = defaultBindings(mac)
  const out: Bindings = { ...imported }
  for (const a of ACTIONS) {
    if (!(a.id in imported)) out[a.id] = defaults[a.id].filter((accel) => findConflicts(imported, SCOPES, a.id, accel).length === 0)
  }
  return out
}

/** The action a keystroke triggers: the focused context first, then global actions. */
export function resolveAction(bindings: Bindings, scopes: Record<string, Scope>, accel: string, ctx: KeyContext): string | undefined {
  const matches = Object.keys(bindings).filter((id) => bindings[id]?.includes(accel))
  return (ctx !== 'none' ? matches.find((id) => scopes[id] === ctx) : undefined) ?? matches.find((id) => (scopes[id] ?? 'global') === 'global')
}

/** Other actions whose binding would compete with `accel` for `actionId` in some context. */
export function findConflicts(bindings: Bindings, scopes: Record<string, Scope>, actionId: string, accel: string): string[] {
  const mine = scopes[actionId] ?? 'global'
  return Object.keys(bindings).filter((id) => {
    if (id === actionId || !bindings[id]?.includes(accel)) return false
    const theirs = scopes[id] ?? 'global'
    return mine === theirs || mine === 'global' || theirs === 'global'
  })
}
