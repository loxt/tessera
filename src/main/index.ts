import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { stopAllAi } from './ai'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { persistence } from './store'

let win: BrowserWindow | null = null
const getWindow = () => win

app.setName('Tessera')
// isolated profile for automated tests and demos (LATTICE_USER_DATA: the name used before the rename)
const userDataOverride = process.env.TESSERA_USER_DATA ?? process.env.LATTICE_USER_DATA
if (userDataOverride) app.setPath('userData', userDataOverride)
else keepLegacyUserData()

/**
 * The app was called Lattice before. Its data (connections, consoles, history, prefs) lives in
 * ~/Library/Application Support/Lattice; keep using that folder rather than starting empty.
 */
function keepLegacyUserData(): void {
  const legacy = join(app.getPath('appData'), 'Lattice')
  if (!existsSync(join(app.getPath('appData'), 'Tessera')) && existsSync(legacy)) app.setPath('userData', legacy)
}

function createWindow(): void {
  const bounds = persistence.getWindow()
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Tessera',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0E0F11' : '#FBFAF7',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())

  // The renderer is an app, not a browser: no navigation, external links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-redirect', (e) => e.preventDefault())

  win.on('close', () => {
    if (!win) return
    persistence.setWindow({ ...win.getNormalBounds(), maximized: win.isMaximized() })
  })
  win.on('closed', () => (win = null))

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // CSP is a <meta> tag injected into the production index.html (electron.vite.config.ts).
  // Clipboard writes are all the renderer needs; every other permission (camera, geolocation…) is denied.
  const allowed = new Set(['clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  const sessions = registerIpc(getWindow, () => buildMenu(getWindow))
  buildMenu(getWindow)
  createWindow()

  let closing = false
  app.on('before-quit', (e) => {
    if (closing) return
    closing = true
    e.preventDefault()
    stopAllAi()
    void sessions.closeAll().finally(() => app.quit())
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
