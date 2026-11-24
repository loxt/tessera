import { useEffect, useRef } from 'react'
import { parseBlocks } from '@shared/ai'
import { formatDuration } from '@shared/history'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { notify } from '../store'
import type { AiEntry } from './useAi'

const KIND_LABEL: Record<AiEntry['kind'], string> = { ask: 'Ask', explain: 'Explain', fix: 'Fix', plan: 'Plan' }

/** `inline code` inside prose */
function Prose({ text }: { text: string }) {
  return (
    <div className="ai-prose">
      {text.split('\n').map((line, i) => (
        <p key={i}>{line.split(/(`[^`]+`)/g).map((part, k) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? <code key={k}>{part.slice(1, -1)}</code> : part))}</p>
      ))}
    </div>
  )
}

interface Props {
  entries: AiEntry[]
  onInsert: (sql: string) => void
  onReplace: (entry: AiEntry, sql: string) => void
  onCancel: (id: string) => void
  onClear: () => void
}

/** The console's AI answers: prose and SQL blocks that go into the editor only when the user says so. */
export function AiPanel({ entries, onInsert, onReplace, onCancel, onClear }: Props) {
  const end = useRef<HTMLDivElement>(null)
  const last = entries[entries.length - 1]
  // a block body: scrollIntoView may return a value, and an effect must return nothing or a cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, last?.text.length])

  const copy = (text: string) =>
    void api
      .copyText(text)
      .then(() => notify('success', 'Copied SQL'))
      .catch((err) => notify('error', errorMessage(err)))

  return (
    <div className="ai-panel">
      <div className="ai-list">
        {entries.map((e) => (
          <section key={e.id} className={`ai-entry ${e.status}`}>
            <header>
              <span className="ai-kind">
                <Icon name="spark" /> {KIND_LABEL[e.kind]}
              </span>
              <span className="ai-title">{e.title}</span>
              <span className="grow" />
              {e.status === 'running' ? (
                <>
                  <span className="spinner" />
                  <span className="muted small">Claude is writing…</span>
                  <button className="btn small" onClick={() => onCancel(e.id)}>Stop</button>
                </>
              ) : (
                e.durationMs !== undefined && (
                  <span className="muted small">
                    {formatDuration(e.durationMs)}
                    {e.costUsd !== undefined ? ` · US$ ${e.costUsd.toFixed(4)}` : ''}
                  </span>
                )
              )}
            </header>
            {parseBlocks(e.text).map((b, i) =>
              b.type === 'text' ? (
                <Prose key={i} text={b.text} />
              ) : (
                <div key={i} className="ai-code">
                  <pre className="mono">{b.text}</pre>
                  {e.status !== 'running' && (
                    <div className="ai-code-actions">
                      {e.kind === 'fix' && e.sql ? (
                        <button className="btn primary small" onClick={() => onReplace(e, b.text)}>Replace the failed statement</button>
                      ) : (
                        <button className="btn primary small" onClick={() => onInsert(b.text)}>Insert into console</button>
                      )}
                      <button className="btn small" onClick={() => copy(b.text)}>
                        <Icon name="copy" /> Copy
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
            {e.status === 'error' && (
              <div className="ai-error">
                <Icon name="alert" /> {e.error}
              </div>
            )}
          </section>
        ))}
        <div ref={end} />
      </div>
      <footer className="ai-foot">
        <Icon name="shield" />
        <span>Sent to Claude through your Claude Code login: your request, the SQL and table/column names. Row data is never sent, and nothing runs until you do.</span>
        <span className="grow" />
        <button className="btn small" onClick={onClear} disabled={!entries.some((e) => e.status !== 'running')}>Clear</button>
      </footer>
    </div>
  )
}
