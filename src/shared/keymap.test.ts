import { describe, expect, test } from 'vitest'
import { bindingsFromIdea, canonicalAccel, effectiveBindings, eventToAccel, findConflicts, parseIdeaKeystroke, resolveAction, resolveIdeaKeymap } from './keymap'

describe('parseIdeaKeystroke', () => {
  test('converts IntelliJ keystrokes to canonical accelerators', () => {
    expect(parseIdeaKeystroke('meta shift L')).toBe('Shift+Cmd+L')
    expect(parseIdeaKeystroke('meta back_space')).toBe('Cmd+Backspace')
    expect(parseIdeaKeystroke('shift ctrl g')).toBe('Ctrl+Shift+G')
    expect(parseIdeaKeystroke('control alt shift ENTER')).toBe('Ctrl+Alt+Shift+Enter')
    expect(parseIdeaKeystroke('alt space')).toBe('Alt+Space')
    expect(parseIdeaKeystroke('meta CLOSE_BRACKET')).toBe('Cmd+]')
    expect(parseIdeaKeystroke('F4')).toBe('F4')
  })
  test('swaps ctrl and meta for $default shortcuts inherited by the macOS keymap', () => {
    expect(parseIdeaKeystroke('control ENTER', true)).toBe('Cmd+Enter')
    expect(parseIdeaKeystroke('control alt L', true)).toBe('Alt+Cmd+L')
    expect(parseIdeaKeystroke('meta control G', true)).toBe('Ctrl+Cmd+G')
  })
  test('returns null for unsupported keys', () => {
    expect(parseIdeaKeystroke('meta NONSENSE_KEY')).toBeNull()
  })
})

describe('canonicalAccel', () => {
  test('normalizes modifier order and CmdOrCtrl per platform', () => {
    expect(canonicalAccel('CmdOrCtrl+Shift+L', true)).toBe('Shift+Cmd+L')
    expect(canonicalAccel('CmdOrCtrl+Shift+L', false)).toBe('Ctrl+Shift+L')
    expect(canonicalAccel('Shift+Alt+CmdOrCtrl+Enter', true)).toBe('Alt+Shift+Cmd+Enter')
  })
})

describe('eventToAccel', () => {
  const ev = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    code, key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods
  })
  test('uses physical key codes so Alt-combinations stay readable', () => {
    expect(eventToAccel(ev('KeyL', { metaKey: true, altKey: true }))).toBe('Alt+Cmd+L')
    expect(eventToAccel(ev('Enter', { metaKey: true }))).toBe('Cmd+Enter')
    expect(eventToAccel(ev('BracketRight', { metaKey: true, shiftKey: true }))).toBe('Shift+Cmd+]')
    expect(eventToAccel(ev('Digit1', { metaKey: true }))).toBe('Cmd+1')
  })
  test('ignores bare modifier presses', () => {
    expect(eventToAccel(ev('ShiftLeft', { shiftKey: true }))).toBeNull()
  })
})

describe('resolveIdeaKeymap', () => {
  const keymaps = {
    $default: { actions: { EditorDuplicate: ['control D'], ReformatCode: ['control alt L'], Find: ['control F'], 'Console.Execute.Multiline': ['control ENTER'] } },
    'Mac OS X 10.5+': { parent: '$default', actions: { Find: ['meta F'] } },
    'macOS copy': { parent: 'Mac OS X 10.5+', actions: { EditorDuplicate: ['meta Y'], ReformatCode: [] } }
  }
  const plugin = { $default: { 'Console.Transaction.Commit': ['control alt shift ENTER'] }, 'Mac OS X 10.5+': { 'Jdbc.OpenConsole.New': ['meta shift L'] } }
  const useShortcutOf = { 'Console.Jdbc.Execute': 'Console.Execute.Multiline' }
  const resolved = resolveIdeaKeymap(keymaps, plugin, useShortcutOf, 'macOS copy', true)

  test('the user keymap overrides its parents, and an empty entry removes the shortcut', () => {
    expect(resolved.get('EditorDuplicate')).toEqual(['Cmd+Y'])
    expect(resolved.get('ReformatCode')).toEqual([])
    expect(resolved.get('Find')).toEqual(['Cmd+F'])
  })
  test('plugin-declared and use-shortcut-of bindings are resolved through the chain', () => {
    expect(resolved.get('Console.Transaction.Commit')).toEqual(['Alt+Shift+Cmd+Enter'])
    expect(resolved.get('Jdbc.OpenConsole.New')).toEqual(['Shift+Cmd+L'])
    expect(resolved.get('Console.Jdbc.Execute')).toEqual(['Cmd+Enter'])
  })
})

describe('bindingsFromIdea', () => {
  test('imported shortcuts win; colliding Tessera defaults are dropped, others kept', () => {
    const b = bindingsFromIdea(new Map([['GotoClass', ['Cmd+O']], ['EditorDuplicate', ['Cmd+Y']]]), true)
    expect(b['search.tables']).toEqual(['Cmd+O'])
    expect(b['editor.duplicate']).toEqual(['Cmd+Y'])
    expect(b['console.openFile']).toEqual([]) // default ⌘O collided with the imported "Go to Table"
    expect(b['query.executeScript']).toEqual(['Alt+Cmd+Enter']) // Tessera-only default survives
  })
})

describe('resolveAction / findConflicts', () => {
  const bindings = { 'query.execute': ['Cmd+Enter'], 'grid.submit': ['Cmd+Enter'], 'editor.duplicate': ['Cmd+D'], 'grid.cloneRow': ['Cmd+D'] }
  const scopes = { 'query.execute': 'global', 'grid.submit': 'grid', 'editor.duplicate': 'editor', 'grid.cloneRow': 'grid' } as const
  test('the focused context wins over global actions', () => {
    expect(resolveAction(bindings, scopes, 'Cmd+Enter', 'grid')).toBe('grid.submit')
    expect(resolveAction(bindings, scopes, 'Cmd+Enter', 'editor')).toBe('query.execute')
    expect(resolveAction(bindings, scopes, 'Cmd+D', 'editor')).toBe('editor.duplicate')
    expect(resolveAction(bindings, scopes, 'Cmd+D', 'none')).toBeUndefined()
  })
  test('conflicts are reported only when scopes overlap', () => {
    expect(findConflicts(bindings, scopes, 'editor.duplicate', 'Cmd+D')).toEqual([])
    expect(findConflicts({ ...bindings, 'tab.close': ['Cmd+D'] }, { ...scopes, 'tab.close': 'global' }, 'editor.duplicate', 'Cmd+D')).toEqual(['tab.close'])
  })
})

describe('effectiveBindings', () => {
  test('keeps ⌥Space for completion on top of an imported keymap (macOS takes ⌃Space for input sources)', () => {
    const b = effectiveBindings({ source: 'DataGrip', bindings: { 'editor.complete': ['Ctrl+Space'] } }, true)
    expect(b['editor.complete']).toEqual(['Ctrl+Space', 'Alt+Space'])
  })
  test('leaves the fallback out when the keymap gives that key to another action', () => {
    const b = effectiveBindings({ source: 'DataGrip', bindings: { 'editor.complete': ['Ctrl+Space'], 'editor.find': ['Alt+Space'] } }, true)
    expect(b['editor.complete']).toEqual(['Ctrl+Space'])
  })
})
