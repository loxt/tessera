import { useState } from 'react'
import { ENVIRONMENTS, environmentLabel, suggestReadOnly, type Environment } from '@shared/environment'
import type { ConnectionInput, Engine, SslMode, TestResult } from '@shared/model'
import { parseConnectionUrl } from '@shared/url'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { onRadioKeyDown, radioTabIndex } from '../components/radio'
import { closeModal, notify, saveConnection, selectNode, toggleExpanded, useApp } from '../store'
import { Modal } from './Dialogs'

export const ENGINE_LABEL: Record<Engine, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' }
const ENGINE_GLYPH: Record<Engine, string> = { postgres: 'PG', mysql: 'My', sqlite: 'SL' }
const ENGINE_NOTE: Record<Engine, string> = { postgres: 'Server', mysql: 'and MariaDB', sqlite: 'Local file' }
const ENVIRONMENT_NOTE: Record<Environment, string> = { local: 'Your machine', staging: 'Shared test data', production: 'Real customers' }
const DEFAULT_PORT: Record<Engine, number | undefined> = { postgres: 5432, mysql: 3306, sqlite: undefined }
export const COLORS = ['', '#db5c5c', '#e5a04b', '#d9c24f', '#5fb865', '#3fb4c6', '#3574f0', '#a58ae6']

type Form = Omit<ConnectionInput, 'password'>

function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  )
}

export function ConnectionDialog({ initial, editId }: { initial?: Partial<ConnectionInput>; editId?: string }) {
  const existing = useApp((s) => s.connections.find((c) => c.id === editId))
  const [form, setForm] = useState<Form>(() => {
    if (existing) {
      const { hasPassword: _hasPassword, ...rest } = existing
      return rest
    }
    const { password: _password, ...init } = initial ?? {}
    const engine = init.engine ?? 'postgres'
    return {
      id: '',
      name: '',
      engine,
      host: engine === 'sqlite' ? undefined : 'localhost',
      port: DEFAULT_PORT[engine],
      user: engine === 'postgres' ? 'postgres' : engine === 'mysql' ? 'root' : undefined,
      database: engine === 'postgres' ? 'postgres' : undefined,
      ssl: 'prefer',
      ...init
    }
  })
  const [password, setPassword] = useState(initial?.password ?? '')
  const [pwTouched, setPwTouched] = useState(initial?.password !== undefined)
  const [url, setUrl] = useState('')
  const [test, setTest] = useState<TestResult | 'running' | null>(null)
  const [saving, setSaving] = useState(false)

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }))
  const autoName = form.engine === 'sqlite' ? (form.file?.split('/').pop() ?? 'sqlite') : `${form.database || ENGINE_LABEL[form.engine]}@${form.host || 'localhost'}`
  const input = (): ConnectionInput => ({
    ...form,
    name: form.name.trim() || autoName,
    password: pwTouched ? password || null : undefined
  })

  const applyUrl = (text: string) => {
    try {
      const { password: pw, ...parsed } = parseConnectionUrl(text)
      setForm((f) => ({ ...f, host: undefined, port: undefined, file: undefined, ...parsed }))
      if (typeof pw === 'string') {
        setPassword(pw)
        setPwTouched(true)
      }
      setUrl('')
    } catch (err) {
      notify('error', errorMessage(err))
    }
  }

  /** Clicking the chosen environment again clears it; entering production turns read-only on. */
  const pickEnvironment = (env: Environment) =>
    setForm((f) => {
      const next = f.environment === env ? undefined : env
      return { ...f, environment: next, readOnly: suggestReadOnly(next, f.environment) ? true : f.readOnly }
    })

  const onTest = async () => {
    setTest('running')
    try {
      setTest(await api.testConnection(input()))
    } catch (err) {
      setTest({ ok: false, ms: 0, error: { message: errorMessage(err) } })
    }
  }

  const onSave = async () => {
    setSaving(true)
    try {
      const saved = await saveConnection(input())
      closeModal()
      toggleExpanded(saved.id, true)
      selectNode(saved.id)
    } catch (err) {
      notify('error', errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const network = form.engine !== 'sqlite'
  return (
    <Modal
      title={existing ? `Data Source Properties — ${existing.name}` : `New ${ENGINE_LABEL[form.engine]} Data Source`}
      onClose={closeModal}
      footer={
        <>
          <div className="left">
            <button className="btn outline" onClick={onTest} disabled={test === 'running'}>
              Test Connection
            </button>
            {test === 'running' && <span className="spinner" />}
            {test && test !== 'running' && (
              <span className={`test-result ${test.ok ? 'ok' : 'err'}`} title={test.ok ? test.version : test.error?.message}>
                <Icon name={test.ok ? 'check' : 'alert'} />
                {test.ok ? `${test.version} · ${test.ms} ms` : test.error?.message}
              </span>
            )}
          </div>
          <button className="btn" onClick={closeModal}>Cancel</button>
          <button className="btn primary" onClick={onSave} disabled={saving}>Save</button>
        </>
      }
    >
      <form className="dialog-body fields" onSubmit={(e) => (e.preventDefault(), void onSave())}>
        <div className="option-cards" role="radiogroup" aria-label="Engine" onKeyDown={onRadioKeyDown}>
          {(Object.keys(ENGINE_LABEL) as Engine[]).map((e, i) => (
            <button
              type="button"
              role="radio"
              key={e}
              className="option-card"
              aria-checked={form.engine === e}
              tabIndex={radioTabIndex(form.engine === e, i, true)}
              disabled={!!existing}
              onClick={() => patch({ engine: e, port: DEFAULT_PORT[e], host: e === 'sqlite' ? undefined : form.host || 'localhost' })}
            >
              <span className="glyph">{ENGINE_GLYPH[e]}</span>
              <span>
                {ENGINE_LABEL[e]}
                <small>{ENGINE_NOTE[e]}</small>
              </span>
            </button>
          ))}
        </div>
        <Field id="conn-name" label="Name">
          <input id="conn-name" className="input" autoFocus placeholder={autoName} value={form.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field id="conn-url" label="Connection URL" hint="Paste a URL and the fields below fill in. The password goes to the Keychain.">
          <span className="row">
            <input
              id="conn-url"
              aria-describedby="conn-url-hint"
              className="input mono"
              placeholder={network ? `${form.engine}://user:pass@host:port/db — paste to fill` : 'sqlite:/path/to/file.db'}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                e.preventDefault()
                applyUrl(e.clipboardData.getData('text'))
              }}
            />
            <button type="button" className="btn outline" disabled={!url} onClick={() => applyUrl(url)}>Apply</button>
          </span>
        </Field>
        {network ? (
          <>
            <div className="pair port">
              <Field id="conn-host" label="Host">
                <input id="conn-host" className="input" value={form.host ?? ''} onChange={(e) => patch({ host: e.target.value })} />
              </Field>
              <Field id="conn-port" label="Port">
                <input id="conn-port" className="input" inputMode="numeric" value={form.port ?? ''} onChange={(e) => patch({ port: e.target.value ? Number(e.target.value) || undefined : undefined })} />
              </Field>
            </div>
            <div className="pair">
              <Field id="conn-user" label="User">
                <input id="conn-user" className="input" value={form.user ?? ''} onChange={(e) => patch({ user: e.target.value })} autoComplete="off" />
              </Field>
              <Field id="conn-password" label="Password">
                <input
                  id="conn-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={existing?.hasPassword && !pwTouched ? '•••••••• (stored in Keychain)' : ''}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setPwTouched(true)
                  }}
                />
              </Field>
            </div>
            <div className="pair">
              <Field id="conn-database" label="Database">
                <input id="conn-database" className="input" value={form.database ?? ''} onChange={(e) => patch({ database: e.target.value })} />
              </Field>
              <Field id="conn-ssl" label="SSL">
                <select id="conn-ssl" className="input" value={form.ssl ?? 'prefer'} onChange={(e) => patch({ ssl: e.target.value as SslMode })}>
                  <option value="disable">Disable</option>
                  <option value="prefer">Prefer (TLS if the server supports it)</option>
                  <option value="require">Require (encrypted, certificate not checked)</option>
                  <option value="verify-full">Verify full (check CA and host name)</option>
                </select>
              </Field>
            </div>
          </>
        ) : (
          <Field id="conn-file" label="File" hint="A new file is created if it does not exist.">
            <span className="row">
              <input id="conn-file" aria-describedby="conn-file-hint" className="input mono" placeholder="/path/to/database.sqlite" value={form.file ?? ''} onChange={(e) => patch({ file: e.target.value })} />
              <button
                type="button"
                className="btn outline"
                onClick={async () => {
                  const f = await api.openFile([{ name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All files', extensions: ['*'] }], false)
                  if (f) patch({ file: f.path })
                }}
              >
                Browse…
              </button>
            </span>
          </Field>
        )}
        <div className="field">
          <span className="lbl">Environment</span>
          <div className="option-cards" role="group" aria-label="Environment">
            {ENVIRONMENTS.map((env) => (
              <button
                type="button"
                key={env}
                className="option-card"
                aria-pressed={form.environment === env}
                style={{ '--c': `var(--env-${env})` } as React.CSSProperties}
                onClick={() => pickEnvironment(env)}
              >
                <span className="dot" />
                <span>
                  {environmentLabel(env)}
                  <small>{ENVIRONMENT_NOTE[env]}</small>
                </span>
              </button>
            ))}
          </div>
          <span className="hint">Production is marked in red everywhere and starts read-only. Click the chosen environment again to clear it.</span>
        </div>
        <div className={form.environment ? '' : 'pair'}>
          <Field id="conn-folder" label="Folder">
            <input id="conn-folder" className="input" placeholder="optional, e.g. Billing" value={form.group ?? ''} onChange={(e) => patch({ group: e.target.value || undefined })} />
          </Field>
          {!form.environment && (
            <div className="field">
              <span className="lbl">Color</span>
              <div className="swatches" style={{ height: 'var(--h-field)', alignItems: 'center' }}>
                {COLORS.map((c) => (
                  <span
                    key={c || 'none'}
                    role="radio"
                    aria-checked={(form.color ?? '') === c}
                    aria-label={c || 'no color'}
                    className={`swatch${(form.color ?? '') === c ? ' on' : ''}`}
                    style={{ background: c || 'transparent', borderStyle: c ? 'solid' : 'dashed', borderColor: (form.color ?? '') === c ? 'var(--text)' : c ? 'transparent' : 'var(--border)' }}
                    onClick={() => patch({ color: c || undefined })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="toggle-row">
          <span>
            <b>Read-only</b>
            <small>Enforced by the server session, not only by Tessera</small>
          </span>
          <button type="button" className="switch" role="switch" aria-checked={!!form.readOnly} aria-label="Read-only" onClick={() => patch({ readOnly: !form.readOnly })} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
