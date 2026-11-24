import type { TesseraApi } from '@shared/api'

declare global {
  interface Window {
    tessera: TesseraApi
  }
}

export const api = window.tessera

/** Strips Electron's "Error invoking remote method 'x': Error: " prefix from IPC rejections. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

export const newId = () => crypto.randomUUID()
