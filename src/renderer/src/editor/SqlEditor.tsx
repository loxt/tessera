import { useEffect, useRef } from 'react'
import { format as formatSql } from 'sql-formatter'
import type { CompletionMetadata, Engine } from '@shared/model'
import { trackEditor } from '../scoped'
import { useApp } from '../store'
import { bindCompletion, installSnippetTab, languageFor, monaco } from './monaco'

interface Props {
  value: string
  engine: Engine
  /** ranks completion by this data source's history */
  connectionId?: string
  readOnly?: boolean
  metadata?: CompletionMetadata
  onChange?: (text: string) => void
  onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void
}

const FORMAT_LANG: Record<Engine, 'postgresql' | 'mysql' | 'sqlite'> = { postgres: 'postgresql', mysql: 'mysql', sqlite: 'sqlite' }

/** Reformats the selection, or the whole document, keeping undo history. */
export function formatEditor(editor: monaco.editor.IStandaloneCodeEditor, engine: Engine): void {
  const model = editor.getModel()
  if (!model) return
  const sel = editor.getSelection()
  const range = sel && !sel.isEmpty() ? sel : model.getFullModelRange()
  const formatted = formatSql(model.getValueInRange(range), { language: FORMAT_LANG[engine], keywordCase: 'upper', tabWidth: 4 })
  editor.executeEdits('format', [{ range, text: formatted }])
}

/** Font settings shared by every editor (Settings → General → Editor font). */
function fontOptions(p: { editorFontSize: number; editorLineHeight: number; editorLigatures: boolean }): monaco.editor.IEditorOptions {
  return { fontSize: p.editorFontSize, lineHeight: p.editorLineHeight, fontLigatures: p.editorLigatures }
}

export function SqlEditor({ value, engine, connectionId, readOnly, metadata, onChange, onReady }: Props) {
  const fontSize = useApp((s) => s.prefs.editorFontSize)
  const lineHeight = useApp((s) => s.prefs.editorLineHeight)
  const ligatures = useApp((s) => s.prefs.editorLigatures)
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const live = useRef({ engine, metadata, onChange, connectionId })
  live.current = { engine, metadata, onChange, connectionId }

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, {
      value,
      language: languageFor(engine),
      ...fontOptions(useApp.getState().prefs),
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Menlo, monospace",
      // DataGrip colors no brackets; rainbow parentheses fight the syntax palette
      bracketPairColorization: { enabled: false },
      guides: { bracketPairs: false, indentation: true },
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordBasedSuggestions: 'off',
      quickSuggestions: { other: true, comments: false, strings: false },
      // a roomier list than Monaco's default: taller rows, details inline, the chosen item previewed
      suggest: { showWords: false, showInlineDetails: true, preview: true, insertMode: 'replace', selectionMode: 'always' },
      suggestFontSize: 13,
      suggestLineHeight: 40,
      snippetSuggestions: 'top',
      renderLineHighlight: 'line',
      lineNumbersMinChars: 3,
      tabSize: 4,
      fixedOverflowWidgets: true,
      padding: { top: 6 }
    })
    editorRef.current = editor
    const model = editor.getModel()!
    const unbind = bindCompletion(model, () => ({ md: live.current.metadata, engine: live.current.engine, connectionId: live.current.connectionId }))
    const snippetTab = installSnippetTab(editor)
    const sub = editor.onDidChangeModelContent(() => live.current.onChange?.(editor.getValue()))
    // editor shortcuts come from the keymap (keys.ts → scoped.ts), not from per-editor bindings
    const untrack = trackEditor(editor, () => live.current.engine)
    onReady?.(editor)
    return () => {
      untrack()
      sub.dispose()
      unbind()
      snippetTab.dispose()
      model.dispose()
      editor.dispose()
    }
    // the editor owns its text after creation; `value` is only the initial content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions(fontOptions({ editorFontSize: fontSize, editorLineHeight: lineHeight, editorLigatures: ligatures }))
  }, [fontSize, lineHeight, ligatures])
  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model) monaco.editor.setModelLanguage(model, languageFor(engine))
  }, [engine])
  useEffect(() => {
    if (readOnly && editorRef.current && editorRef.current.getValue() !== value) editorRef.current.setValue(value)
  }, [readOnly, value])

  return (
    <div className="editor-host">
      <div ref={host} />
    </div>
  )
}
