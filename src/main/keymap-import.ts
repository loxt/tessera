// Imports the user's active DataGrip keymap. Reads (never writes) the DataGrip settings
// directory and the shortcut descriptors bundled in the installed app's JARs.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { bindingsFromIdea, resolveIdeaKeymap, type IdeaKeymap, type KeymapState } from '@shared/keymap'

const run = promisify(execFile)

export interface KeymapImport {
  state: KeymapState
  /** Tessera actions that received a shortcut from DataGrip */
  mapped: number
  /** two-keystroke (chord) shortcuts, which Tessera does not support */
  chordsSkipped: number
}

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
const ACTION_RE = /<action\b([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/g
const SHORTCUT_RE = /<keyboard-shortcut\b([^>]*?)\/>/g

interface Parsed {
  keymap: IdeaKeymap & { name: string }
  chords: number
}

/** A keymap XML (bundled or user-defined). */
export function parseKeymapXml(xml: string): Parsed {
  const head = attrs(/<keymap\b([^>]*)>/.exec(xml)?.[1] ?? '')
  const actions: Record<string, string[]> = {}
  let chords = 0
  for (const m of xml.matchAll(ACTION_RE)) {
    const id = attrs(m[1]).id
    if (!id) continue
    const strokes: string[] = []
    for (const s of (m[2] ?? '').matchAll(SHORTCUT_RE)) {
      const a = attrs(s[1])
      if (a['second-keystroke']) chords++
      else if (a['first-keystroke']) strokes.push(a['first-keystroke'])
    }
    actions[id] = strokes
  }
  return { keymap: { name: head.name ?? '', parent: head.parent, actions }, chords }
}

/** Shortcuts and use-shortcut-of declared inside plugin descriptors. */
export function parsePluginXml(xml: string, into: { shortcuts: Record<string, Record<string, string[]>>; useShortcutOf: Record<string, string> }): void {
  for (const m of xml.matchAll(ACTION_RE)) {
    const a = attrs(m[1])
    if (!a.id) continue
    if (a['use-shortcut-of']) into.useShortcutOf[a.id] = a['use-shortcut-of']
    for (const s of (m[2] ?? '').matchAll(SHORTCUT_RE)) {
      const k = attrs(s[1])
      if (!k.keymap || !k['first-keystroke'] || k['second-keystroke']) continue
      ;((into.shortcuts[k.keymap] ??= {})[a.id] ??= []).push(k['first-keystroke'])
    }
  }
}

function findConfigDir(): string | undefined {
  const base = join(homedir(), 'Library/Application Support/JetBrains')
  if (!existsSync(base)) return undefined
  const dirs = readdirSync(base).filter((d) => /^DataGrip\d{4}\.\d+$/.test(d))
  dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return dirs.length ? join(base, dirs.at(-1)!) : undefined
}

function findApp(): string | undefined {
  const candidates = [join(homedir(), 'Applications/DataGrip.app'), '/Applications/DataGrip.app']
  const toolbox = join(homedir(), 'Library/Application Support/JetBrains/Toolbox/apps')
  if (existsSync(toolbox)) {
    for (const d of readdirSync(toolbox).filter((n) => /datagrip/i.test(n))) candidates.push(join(toolbox, d, 'DataGrip.app'))
  }
  return candidates.find((p) => existsSync(join(p, 'Contents/lib')))
}

function findFiles(dir: string, test: (name: string) => boolean, depth = 4): string[] {
  if (depth < 0 || !existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? findFiles(join(dir, e.name), test, depth - 1) : test(e.name) ? [join(dir, e.name)] : []
  )
}

const unzip = async (args: string[]) => (await run('/usr/bin/unzip', args, { maxBuffer: 256 * 1024 * 1024 })).stdout

export async function importDataGripKeymap(): Promise<KeymapImport> {
  if (process.platform !== 'darwin') throw new Error('DataGrip keymap import is only supported on macOS')
  const config = findConfigDir()
  const app = findApp()
  if (!config || !app) throw new Error('DataGrip installation or settings directory not found')

  const keymapXml = ['options/mac/keymap.xml', 'options/keymap.xml'].map((f) => join(config, f)).find(existsSync)
  const active = (keymapXml && /<active_keymap name="([^"]+)"/.exec(readFileSync(keymapXml, 'utf8'))?.[1]) || 'Mac OS X 10.5+'

  const keymaps: Record<string, IdeaKeymap> = {}
  let chords = 0
  const add = (xml: string) => {
    const p = parseKeymapXml(xml)
    if (p.keymap.name) keymaps[p.keymap.name] = p.keymap
    chords += p.chords
  }

  // bundled keymaps (inside the platform JAR)
  const platformJar = findFiles(join(app, 'Contents/lib'), (n) => n === 'intellij.platform.ide.impl.jar')[0]
  if (platformJar) {
    const entries = (await unzip(['-Z1', platformJar, 'keymaps/*'])).split('\n').filter((e) => e.endsWith('.xml'))
    for (const e of entries) add(await unzip(['-p', platformJar, e]))
  }
  // user keymaps override bundled ones with the same name
  const userDir = join(config, 'keymaps')
  if (existsSync(userDir)) for (const f of readdirSync(userDir).filter((n) => n.endsWith('.xml'))) add(readFileSync(join(userDir, f), 'utf8'))
  if (!keymaps[active]) throw new Error(`Active keymap "${active}" was not found`)

  // shortcuts declared by the database/grid plugins and the DataGrip product module
  const plugin = { shortcuts: {} as Record<string, Record<string, string[]>>, useShortcutOf: {} as Record<string, string> }
  const pluginDirs = ['DatabaseTools', 'grid-core-plugin', 'grid-plugin', 'datagrip-impl'].map((p) => join(app, 'Contents/plugins', p))
  const jars = [...pluginDirs.flatMap((d) => findFiles(d, (n) => n.endsWith('.jar'))), ...findFiles(join(app, 'Contents/lib'), (n) => n === 'intellij.datagrip.jar')]
  for (const jar of jars) {
    try {
      parsePluginXml(await unzip(['-p', jar, '*.xml']), plugin)
    } catch {
      // a JAR without XML descriptors makes unzip exit non-zero; nothing to import from it
    }
  }

  const resolved = resolveIdeaKeymap(keymaps, plugin.shortcuts, plugin.useShortcutOf, active, true)
  const bindings = bindingsFromIdea(resolved, true)
  const version = basename(config).replace('DataGrip', '')
  return { state: { source: `DataGrip ${version} · keymap "${active}"`, bindings }, mapped: Object.values(bindings).filter((v) => v.length).length, chordsSkipped: chords }
}
