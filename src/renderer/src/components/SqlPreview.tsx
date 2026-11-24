import { useEffect, useState } from 'react'
import type { Engine } from '@shared/model'
import { languageFor, monaco } from '../editor/monaco'

/**
 * Read-only SQL with the editor's own highlighting (same tokenizer and theme), without the cost
 * of a Monaco editor instance. Falls back to plain text until colorizing finishes.
 */
export function SqlPreview({ sql, engine, className = '' }: { sql: string; engine: Engine; className?: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    // colorize() escapes the text it is given, so its HTML is safe to insert
    monaco.editor
      .colorize(sql, languageFor(engine), { tabSize: 4 })
      // colorize() keeps indentation with non-breaking spaces; copied into a console they break the SQL.
      // .sql-preview is white-space: pre-wrap, so plain spaces keep the layout.
      .then((h) => live && setHtml(h.replace(/&nbsp;|&#160;| /g, ' ')))
      .catch((err) => {
        console.error('[tessera] SQL colorize failed', err)
        if (live) setHtml(null)
      })
    return () => {
      live = false
    }
  }, [sql, engine])
  return html === null ? (
    <pre className={`preview mono sql-preview ${className}`}>{sql}</pre>
  ) : (
    <pre className={`preview mono sql-preview ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
