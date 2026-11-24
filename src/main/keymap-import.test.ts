import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { importDataGripKeymap, parseKeymapXml, parsePluginXml } from './keymap-import'

describe('parseKeymapXml', () => {
  test('reads name, parent, removed actions and skips chords', () => {
    const p = parseKeymapXml(`<keymap version="1" name="macOS copy" parent="Mac OS X 10.5+">
      <action id="CompareTwoFiles" />
      <action id="EditorDeleteLine">
        <keyboard-shortcut first-keystroke="meta back_space" />
        <keyboard-shortcut first-keystroke="meta d" />
      </action>
      <action id="Chorded"><keyboard-shortcut first-keystroke="meta K" second-keystroke="meta C" /></action>
    </keymap>`)
    expect(p.keymap).toEqual({ name: 'macOS copy', parent: 'Mac OS X 10.5+', actions: { CompareTwoFiles: [], EditorDeleteLine: ['meta back_space', 'meta d'], Chorded: [] } })
    expect(p.chords).toBe(1)
  })
})

describe('parsePluginXml', () => {
  test('collects per-keymap shortcuts and use-shortcut-of, including self-closing siblings', () => {
    const into = { shortcuts: {}, useShortcutOf: {} } as Parameters<typeof parsePluginXml>[1]
    parsePluginXml(`<actions>
      <action id="A" class="x" use-shortcut-of="Stop"/>
      <action id="B" class="y">
        <keyboard-shortcut keymap="$default" first-keystroke="control alt shift ENTER"/>
        <keyboard-shortcut keymap="Mac OS X 10.5+" first-keystroke="meta I"/>
      </action>
    </actions>`, into)
    expect(into.useShortcutOf).toEqual({ A: 'Stop' })
    expect(into.shortcuts).toEqual({ $default: { B: ['control alt shift ENTER'] }, 'Mac OS X 10.5+': { B: ['meta I'] } })
  })
})

// Runs against the real DataGrip on this machine when present (skipped elsewhere).
const hasDataGrip = process.platform === 'darwin' && [join(homedir(), 'Applications/DataGrip.app'), '/Applications/DataGrip.app'].some(existsSync)

describe.skipIf(!hasDataGrip)('importDataGripKeymap (installed DataGrip)', () => {
  test('resolves the active keymap into Tessera bindings', async () => {
    const r = await importDataGripKeymap()
    expect(r.state.source).toMatch(/^DataGrip \d{4}\.\d+ · keymap "/)
    expect(r.mapped).toBeGreaterThan(20)
    // DataGrip's built-in macOS defaults that every keymap derived from it inherits
    expect(r.state.bindings['query.execute']).toContain('Cmd+Enter')
    expect(r.state.bindings['console.new']).toContain('Shift+Cmd+L')
    expect(r.state.bindings['editor.format']).toContain('Alt+Cmd+L')
  }, 60_000)
})
