import { useMemo, useState } from 'react'
import { jsonTokens, prettyJson } from '@shared/json'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { closeModal, notify, type Modal as ModalState } from '../store'
import { Modal } from './Dialogs'

/** A JSON cell, indented and colored with the editor's syntax palette; editable when the table is. */
export function JsonDialog({ m }: { m: Extract<ModalState, { kind: 'json' }> }) {
  const pretty = useMemo(() => prettyJson(m.text), [m.text])
  const tokens = useMemo(() => jsonTokens(pretty.text), [pretty.text])
  const [wrap, setWrap] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const check = useMemo(() => (draft === null ? null : prettyJson(draft)), [draft])

  const copy = async (text: string, what: string) => {
    try {
      await api.copyText(text)
      notify('success', `Copied ${what}`)
    } catch (err) {
      notify('error', `Copy failed: ${errorMessage(err)}`)
    }
  }
  const save = () => {
    if (!check?.ok || draft === null || !m.onSave) return
    // compact, like the database stores jsonb; the pending change shows it in the grid
    m.onSave(JSON.stringify(JSON.parse(draft)))
    closeModal()
  }

  const editing = draft !== null
  return (
    <Modal
      title={m.title}
      wide
      onClose={closeModal}
      footer={
        editing ? (
          <>
            <div className="left">
              <button className="btn" disabled={!check?.ok} onClick={() => check?.ok && setDraft(check.text)}>
                Format
              </button>
              {check && !check.ok && (
                <span className="test-result err" role="alert">
                  <Icon name="alert" /> {check.error}
                </span>
              )}
            </div>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={!check?.ok} onClick={save}>
              Save change
            </button>
          </>
        ) : (
          <>
            <div className="left">
              <button className="btn" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>
                {wrap ? 'No wrap' : 'Wrap lines'}
              </button>
            </div>
            {m.onSave && (
              <button className="btn outline" onClick={() => setDraft(pretty.text)}>
                <Icon name="edit" /> Edit
              </button>
            )}
            <button className="btn outline" onClick={() => void copy(pretty.ok ? JSON.stringify(JSON.parse(m.text)) : m.text, 'compact JSON')}>
              Copy compact
            </button>
            <button className="btn primary" onClick={() => void copy(pretty.text, 'formatted JSON')}>
              <Icon name="copy" /> Copy formatted
            </button>
          </>
        )
      }
    >
      <div className="dialog-body">
        {!pretty.ok && !editing && (
          <div className="banner error" style={{ marginBottom: 10, borderRadius: 10 }}>
            Not valid JSON ({pretty.error}); showing it as stored.
          </div>
        )}
        {editing ? (
          <>
            <textarea
              className={`input json-edit${check && !check.ok ? ' invalid' : ''}`}
              aria-label="JSON value"
              aria-invalid={!!check && !check.ok}
              spellCheck={false}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.metaKey && (e.preventDefault(), save())}
            />
            <div className="muted small" style={{ marginTop: 8 }}>
              Saving adds a pending change to the grid; it reaches the database when you Submit.
            </div>
          </>
        ) : (
          <pre className={`json-view${wrap ? ' wrap' : ''}`}>
            {tokens.map((t, i) => (t.type === 'punct' ? t.text : <span key={i} className={`jt-${t.type}`}>{t.text}</span>))}
          </pre>
        )}
      </div>
    </Modal>
  )
}
