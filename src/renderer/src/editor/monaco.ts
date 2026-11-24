import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import type { CompletionMetadata, Engine } from '@shared/model'
import { matchSnippets, toMonacoSnippet, type Snippet } from '@shared/snippets'
import { suggest, type Suggestion } from './completion'
import { sqlLanguage, type SqlDialect } from './sqlLanguage'
import { usageFor } from './usage'

/** connectionId ranks suggestions by that data source's query history */
type CompletionContext = () => { md?: CompletionMetadata; engine: Engine; connectionId?: string }

/** model URI → live context (connection metadata can change while the editor is open) */
const contexts = new Map<string, CompletionContext>()

export function bindCompletion(model: monaco.editor.ITextModel, ctx: CompletionContext): () => void {
  const key = model.uri.toString()
  contexts.set(key, ctx)
  return () => contexts.delete(key)
}

// Own language ids: Monaco's built-in pgsql/mysql/sql grammars load lazily and would overwrite
// our tokenizer the first time a model uses them.
const LANG: Record<Engine, string> = { postgres: 'tessera-pgsql', mysql: 'tessera-mysql', sqlite: 'tessera-sql' }
const DIALECT: Record<string, SqlDialect> = { 'tessera-pgsql': 'pgsql', 'tessera-mysql': 'mysql', 'tessera-sql': 'sql' }

export const languageFor = (e: Engine) => LANG[e]

const SQL_CONFIG: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '--', blockComment: ['/*', '*/'] },
  brackets: [['(', ')'], ['[', ']']],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: '`', close: '`', notIn: ['string', 'comment'] }
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
    { open: '`', close: '`' }
  ],
  wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g
}

const NO_METADATA: CompletionMetadata = { defaultSchema: '', schemas: [], tables: [] }

const KIND: Record<Suggestion['kind'], monaco.languages.CompletionItemKind> = {
  column: monaco.languages.CompletionItemKind.Field,
  table: monaco.languages.CompletionItemKind.Struct,
  view: monaco.languages.CompletionItemKind.Interface,
  schema: monaco.languages.CompletionItemKind.Module,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  join: monaco.languages.CompletionItemKind.Reference
}

let initialized = false

/** where the editor reads the user's snippets from (the app store), set once at startup */
let snippetSource: () => Snippet[] = () => []
export const setSnippetSource = (source: () => Snippet[]) => {
  snippetSource = source
}

/** The snippet whose prefix is exactly the word before the caret, if any. */
function snippetAtCaret(editor: monaco.editor.ICodeEditor): { snippet: Snippet; length: number } | null {
  const model = editor.getModel()
  const pos = editor.getPosition()
  if (!model || !pos) return null
  const word = model.getWordUntilPosition(pos).word
  const snippet = word && snippetSource().find((s) => s.prefix.toLowerCase() === word.toLowerCase())
  return snippet ? { snippet, length: word.length } : null
}

interface SnippetController {
  insert(template: string, opts?: { overwriteBefore?: number }): void
}

/**
 * "prefix + Tab" expands a snippet. Monaco's own tabCompletion lives in VS Code's workbench, not in
 * the standalone editor, so Tab is bound here — only while the word before the caret is a prefix and
 * neither the suggest list nor a snippet session owns Tab.
 */
export function installSnippetTab(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  const atPrefix = editor.createContextKey<boolean>('tesseraSnippetAtCaret', false)
  const update = () => atPrefix.set(!!snippetAtCaret(editor))
  const subs = [editor.onDidChangeCursorPosition(update), editor.onDidChangeModelContent(update)]
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      const hit = snippetAtCaret(editor)
      if (!hit) return editor.trigger('keyboard', 'tab', null)
      editor.getContribution<monaco.editor.IEditorContribution & SnippetController>('snippetController2')?.insert(toMonacoSnippet(hit.snippet.body), { overwriteBefore: hit.length })
    },
    'tesseraSnippetAtCaret && editorTextFocus && !editorHasSelection && !suggestWidgetVisible && !inSnippetMode'
  )
  return { dispose: () => subs.forEach((s) => s.dispose()) }
}

export function setupMonaco(): void {
  if (initialized) return
  initialized = true
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

  // themes are defined per color theme in ../theme.ts

  for (const [lang, dialect] of Object.entries(DIALECT)) {
    monaco.languages.register({ id: lang })
    monaco.languages.setLanguageConfiguration(lang, SQL_CONFIG)
    monaco.languages.setMonarchTokensProvider(lang, sqlLanguage(dialect))
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.'],
      provideCompletionItems(model, position) {
        const ctx = contexts.get(model.uri.toString())?.()
        if (!ctx) return { suggestions: [] }
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        // snippets also show in the suggest list, where Tab or Enter picks them
        const snippets = matchSnippets(snippetSource(), word.word).map((s) => ({
          label: s.prefix,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: s.name,
          documentation: { value: '```sql\n' + s.body + '\n```' },
          insertText: toMonacoSnippet(s.body),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '0',
          range
        }))
        // metadata may still be loading (large catalogs take a while): offer keywords now and mark the
        // list incomplete so Monaco asks again on the next keystroke instead of reusing it
        const md = ctx.md ?? NO_METADATA
        const usage = ctx.connectionId ? usageFor(ctx.connectionId, ctx.engine) : undefined
        const items = suggest(model.getValue(), model.getOffsetAt(position), md, ctx.engine, usage)
        return {
          incomplete: !ctx.md,
          suggestions: [
            ...snippets,
            ...items.map((s) => ({
              label: s.label,
              kind: KIND[s.kind],
              detail: s.detail,
              insertText: s.insertText,
              sortText: s.sortText,
              range
            }))
          ]
        }
      }
    })
  }
}

export { monaco }
