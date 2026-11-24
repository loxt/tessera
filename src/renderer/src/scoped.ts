// Targets for editor- and grid-scoped actions: the SQL editor / data grid that last had focus.
import type { Engine } from '@shared/model'
import type { monaco } from './editor/monaco'
import { formatEditor } from './editor/SqlEditor'
import { openModal } from './store'

type Editor = monaco.editor.IStandaloneCodeEditor

let lastEditor: { editor: Editor; engine: () => Engine } | null = null
let lastGrid: ((actionId: string) => boolean) | null = null

export function trackEditor(editor: Editor, engine: () => Engine): () => void {
  const entry = { editor, engine }
  const sub = editor.onDidFocusEditorWidget(() => (lastEditor = entry))
  return () => {
    sub.dispose()
    if (lastEditor === entry) lastEditor = null
  }
}

/** Grids call this on focus; the handler returns false when it can't run a command (e.g. read-only). */
export function trackGrid(handler: (actionId: string) => boolean): () => void {
  lastGrid = handler
  return () => {
    if (lastGrid === handler) lastGrid = null
  }
}

/** DataGrip's Toggle Case: upper-case unless the text already is. */
function toggleCase(ed: Editor): void {
  const model = ed.getModel()
  const sel = ed.getSelection()
  if (!model || !sel) return
  const text = sel.isEmpty() ? (model.getWordAtPosition(sel.getStartPosition())?.word ?? '') : model.getValueInRange(sel)
  ed.trigger('keymap', text && text === text.toUpperCase() ? 'editor.action.transformToLowercase' : 'editor.action.transformToUppercase', null)
}

/** The selection (or the whole console when nothing is selected) becomes a new snippet's body. */
function saveSnippet(ed: Editor): void {
  const model = ed.getModel()
  const sel = ed.getSelection()
  if (!model) return
  const text = sel && !sel.isEmpty() ? model.getValueInRange(sel) : model.getValue()
  openModal({ kind: 'settings', tab: 'snippets', snippetDraft: text.trim() })
}

/** Tessera editor action → Monaco command id (or a custom implementation). */
const EDITOR: Record<string, string | ((ed: Editor, engine: Engine) => void)> = {
  'editor.format': (ed, engine) => formatEditor(ed, engine),
  'editor.comment': 'editor.action.commentLine',
  'editor.blockComment': 'editor.action.blockComment',
  'editor.duplicate': 'editor.action.copyLinesDownAction',
  'editor.deleteLine': 'editor.action.deleteLines',
  'editor.moveLineUp': 'editor.action.moveLinesUpAction',
  'editor.moveLineDown': 'editor.action.moveLinesDownAction',
  'editor.startNewLine': 'editor.action.insertLineAfter',
  'editor.joinLines': 'editor.action.joinLines',
  'editor.toggleCase': toggleCase,
  'editor.saveSnippet': saveSnippet,
  'editor.expandSelection': 'editor.action.smartSelect.expand',
  'editor.shrinkSelection': 'editor.action.smartSelect.shrink',
  'editor.selectNextOccurrence': 'editor.action.addSelectionToNextFindMatch',
  'editor.selectAllOccurrences': 'editor.action.selectHighlights',
  'editor.unselectOccurrence': 'cursorUndo',
  'editor.cloneCaretAbove': 'editor.action.insertCursorAbove',
  'editor.cloneCaretBelow': 'editor.action.insertCursorBelow',
  'editor.complete': 'editor.action.triggerSuggest',
  'editor.find': 'actions.find',
  'editor.replace': 'editor.action.startFindReplaceAction',
  'editor.gotoLine': 'editor.action.gotoLine',
  'editor.fold': 'editor.fold',
  'editor.unfold': 'editor.unfold',
  'editor.foldAll': 'editor.foldAll',
  'editor.unfoldAll': 'editor.unfoldAll'
}

export function runEditorAction(id: string): boolean {
  const cmd = EDITOR[id]
  if (!lastEditor || !cmd) return false
  const { editor, engine } = lastEditor
  editor.focus()
  if (typeof cmd === 'string') editor.trigger('keymap', cmd, null)
  else cmd(editor, engine())
  return true
}

export const runGridAction = (id: string): boolean => lastGrid?.(id) ?? false
