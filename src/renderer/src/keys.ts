// The single keyboard entry point: maps keystrokes to actions through the user's keymap,
// with IntelliJ-style context precedence (focused editor/grid first, then global).
import { eventToAccel, resolveAction, SCOPES, type KeyContext } from '@shared/keymap'
import { dispatch } from './actions'
import { runGridAction } from './scoped'
import { useApp } from './store'

let lastHandled = { id: '', at: 0 }

/** The native menu shows (but doesn't register) the same keys; ignore its echo of a key we handled. */
export const handledByKeyboard = (id: string) => lastHandled.id === id && Date.now() - lastHandled.at < 400

export function keyContext(el: Element | null): KeyContext {
  if (el?.closest('.monaco-editor')) return 'editor'
  if (el?.closest('.grid')) return 'grid'
  return 'none'
}

const isTextField = (el: Element | null) =>
  !!el && !el.closest('.monaco-editor') && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing || useApp.getState().modal) return
  const accel = eventToAccel(e)
  if (!accel) return
  const el = document.activeElement
  const typing = isTextField(el)
  // in plain text fields (filters, grid cell editor) unmodified keys belong to the field,
  // and grid/editor shortcuts don't apply — only global ones with a modifier
  if (typing && !/(^|\+)(Ctrl|Alt|Cmd)\+/.test(accel)) return
  const { bindings } = useApp.getState()
  const ctx: KeyContext = typing ? 'none' : keyContext(el)
  let id = resolveAction(bindings, SCOPES, accel, ctx)
  if (!id) return
  if (SCOPES[id] === 'grid') {
    if (runGridAction(id)) return consume(e, id)
    // the grid declined (read-only result, nothing selected…): fall back to a global action
    id = resolveAction(bindings, SCOPES, accel, 'none')
    if (!id) return
  }
  consume(e, id)
  dispatch(id)
}

function consume(e: KeyboardEvent, id: string): void {
  e.preventDefault()
  e.stopPropagation()
  lastHandled = { id, at: Date.now() }
}

export function installKeymap(): () => void {
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
