import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type TesseraApi } from '@shared/api'

const api = Object.fromEntries(
  API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(name, ...args)])
) as Omit<TesseraApi, 'onAction' | 'onExportProgress' | 'onAiText' | 'flushSession'>

contextBridge.exposeInMainWorld('tessera', {
  ...api,
  flushSession: (state, consoles) => void ipcRenderer.sendSync('flushSession', state, consoles),
  onAction(cb: (actionId: string) => void) {
    const listener = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('action', listener)
    return () => ipcRenderer.removeListener('action', listener)
  },
  onExportProgress(cb) {
    const listener = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('exportProgress', listener)
    return () => ipcRenderer.removeListener('exportProgress', listener)
  },
  onAiText(cb) {
    const listener = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('aiText', listener)
    return () => ipcRenderer.removeListener('aiText', listener)
  }
} satisfies TesseraApi)
