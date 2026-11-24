import { useState } from 'react'
import { DEFAULT_SNIPPETS, isValidPrefix, placeholderNames, type Snippet } from '@shared/snippets'
import { Icon } from '../components/Icon'
import { saveSnippets, useApp } from '../store'

/** a free prefix for a new snippet: snip, snip2, snip3… */
function freePrefix(list: Snippet[]): string {
  const taken = new Set(list.map((s) => s.prefix.toLowerCase()))
  let n = 1
  while (taken.has(n === 1 ? 'snip' : `snip${n}`)) n++
  return n === 1 ? 'snip' : `snip${n}`
}

function prefixError(prefix: string, list: Snippet[], index: number): string {
  if (!isValidPrefix(prefix)) return 'Start with a letter; use letters, digits or _ (up to 32).'
  if (list.some((s, i) => i !== index && s.prefix.toLowerCase() === prefix.toLowerCase())) return `Another snippet already uses "${prefix}".`
  return ''
}

/** Settings → Snippets: list on the left, the chosen snippet's fields on the right. */
export function SnippetsPanel({ draft }: { draft?: string }) {
  const saved = useApp((s) => s.snippets)
  // edits live here until they are valid, so an invalid prefix never reaches snippets.json
  const [list, setList] = useState<Snippet[]>(() => (draft ? [...saved, { prefix: freePrefix(saved), name: 'New snippet', body: draft }] : saved))
  const [index, setIndex] = useState(() => (draft ? saved.length : 0))
  const current = list[index] as Snippet | undefined

  const commit = (next: Snippet[]) => {
    setList(next)
    if (next.every((s, i) => !prefixError(s.prefix, next, i) && s.name.trim() && s.body.trim())) saveSnippets(next)
  }
  const patch = (p: Partial<Snippet>) => commit(list.map((s, i) => (i === index ? { ...s, ...p } : s)))
  const add = () => {
    const next = [...list, { prefix: freePrefix(list), name: 'New snippet', body: 'SELECT *\nFROM {{table}}\nWHERE {{cursor}};' }]
    commit(next)
    setIndex(next.length - 1)
  }
  const remove = (i: number) => {
    commit(list.filter((_, k) => k !== i))
    setIndex((x) => Math.max(0, x >= i ? x - 1 : x))
  }
  // a confirm() dialog would replace Settings (one modal at a time), so the button asks twice instead
  const [confirmReset, setConfirmReset] = useState(false)
  const reset = () => {
    if (!confirmReset) return setConfirmReset(true)
    setConfirmReset(false)
    commit(DEFAULT_SNIPPETS)
    setIndex(0)
  }

  const error = current ? prefixError(current.prefix, list, index) : ''
  const stops = current ? placeholderNames(current.body) : []
  return (
    <div className="snippets">
      <div className="snip-list" role="listbox" aria-label="Snippets">
        {list.map((s, i) => (
          <div key={i} role="option" aria-selected={i === index} className={`snip-item${i === index ? ' on' : ''}`} onClick={() => setIndex(i)}>
            <span className="kchip">{s.prefix || '…'}</span>
            <span className="grow">{s.name}</span>
            <button className="btn icon" aria-label={`Delete ${s.prefix}`} onClick={(e) => (e.stopPropagation(), remove(i))}>
              <Icon name="close" />
            </button>
          </div>
        ))}
        {list.length === 0 && <div className="muted small" style={{ padding: 12 }}>No snippets. Add one, or restore the defaults.</div>}
        <div className="snip-actions">
          <button className="btn outline small" onClick={add}>
            <Icon name="plus" /> New snippet
          </button>
          <button className={`btn small${confirmReset ? ' danger' : ''}`} onClick={reset} onBlur={() => setConfirmReset(false)}>
            {confirmReset ? 'Replace all with defaults?' : 'Restore defaults'}
          </button>
        </div>
      </div>
      {current ? (
        <div className="fields snip-form">
          <div className="pair">
            <div className="field">
              <label className="lbl" htmlFor="snip-prefix">Prefix</label>
              <input id="snip-prefix" className="input mono" aria-invalid={!!error} aria-describedby="snip-prefix-hint" value={current.prefix} onChange={(e) => patch({ prefix: e.target.value.trim() })} />
              <span id="snip-prefix-hint" className={`hint${error ? ' err' : ''}`}>{error || 'Type it in a console and press Tab.'}</span>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="snip-name">Name</label>
              <input id="snip-name" className="input" value={current.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="snip-body">SQL</label>
            <textarea id="snip-body" className="input mono" rows={9} spellCheck={false} aria-describedby="snip-body-hint" value={current.body} onChange={(e) => patch({ body: e.target.value })} />
            <span id="snip-body-hint" className="hint">
              Write <span className="mono">{'{{table}}'}</span> where Tab should stop; the same name twice is filled once. <span className="mono">{'{{cursor}}'}</span> is where the caret ends.
            </span>
          </div>
          {stops.length > 0 && (
            <div className="snip-stops">
              <span className="muted small">Tab stops</span>
              {stops.map((n, i) => (
                <span key={n} className="chip">
                  {i + 1} · {n}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="empty">Pick a snippet on the left.</div>
      )}
    </div>
  )
}
