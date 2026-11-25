import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { ACTIONS, type ActionDef, type MenuName } from '@shared/actions'
import { effectiveBindings, type Bindings } from '@shared/keymap'
import { persistence } from './store'
import { currentWorkspace, listWorkspaces, switchWorkspace } from './workspace'

const isMac = process.platform === 'darwin'

function item(a: ActionDef, bindings: Bindings, getWindow: () => BrowserWindow | null): MenuItemConstructorOptions {
  return {
    label: a.title,
    accelerator: bindings[a.id]?.[0],
    // the renderer's keymap dispatcher owns every shortcut (it knows editor/grid context);
    // the menu only shows the key, so the keystroke reaches the page
    registerAccelerator: false,
    click: () => getWindow()?.webContents.send('action', a.id)
  }
}

function section(name: MenuName, bindings: Bindings, getWindow: () => BrowserWindow | null): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const a of ACTIONS.filter((x) => x.menu === name && !(isMac && x.id === 'settings.open'))) {
    if (a.separatorBefore && out.length) out.push({ type: 'separator' })
    out.push(item(a, bindings, getWindow))
  }
  return out
}

/** File › Workspace: the default workspace, the ones created so far, and "New Workspace…". */
function workspaceMenu(bindings: Bindings, getWindow: () => BrowserWindow | null): MenuItemConstructorOptions {
  const entry = (label: string, name: string | undefined): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: name === currentWorkspace,
    click: () => switchWorkspace(name)
  })
  return {
    label: 'Workspace',
    submenu: [
      entry('Default', undefined),
      ...listWorkspaces().map((w) => entry(w, w)),
      { type: 'separator' },
      item(ACTIONS.find((a) => a.id === 'workspace.new')!, bindings, getWindow)
    ]
  }
}

/** (Re)builds the application menu from the effective keymap. */
export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const bindings = effectiveBindings(persistence.getKeymap() ?? undefined, isMac)
  const settings = ACTIONS.find((a) => a.id === 'settings.open')!
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              item(settings, bindings, getWindow),
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        ...section('File', bindings, getWindow),
        { type: 'separator' },
        workspaceMenu(bindings, getWindow),
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        ...section('Edit', bindings, getWindow)
      ]
    },
    { label: 'View', submenu: [...section('View', bindings, getWindow), { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
    { label: 'Navigate', submenu: section('Navigate', bindings, getWindow) },
    { label: 'Database', submenu: section('Database', bindings, getWindow) },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
