import { useEffect, useMemo, useState } from 'react'
import { connectionAccent } from '@shared/environment'
import type { ConnectionProfile } from '@shared/model'
import { diffSchemas, migrationSql, type DiffItem } from '@shared/schemaDiff'
import { api, errorMessage } from '../api'
import { Icon } from '../components/Icon'
import { activeTab, closeModal, ensureMetadata, openConsole, useApp } from '../store'
import { Modal } from './Dialogs'

interface Side {
  connectionId: string
  schema: string
}

const SIGN: Record<DiffItem['kind'], '+' | '−' | '~'> = {
  'table-added': '+',
  'table-removed': '−',
  'column-added': '+',
  'column-removed': '−',
  'column-changed': '~',
  'index-added': '+',
  'index-removed': '−',
  'fk-added': '+',
  'fk-removed': '−',
  'pk-changed': '~'
}

function describe(it: DiffItem): string {
  switch (it.kind) {
    case 'table-added':
      return 'table only in the source'
    case 'table-removed':
      return 'table only in the target'
    case 'column-added':
      return `column ${it.column.name} ${it.column.type}${it.column.nullable ? '' : ' NOT NULL'}`
    case 'column-removed':
      return `column ${it.column} (only in the target)`
    case 'column-changed':
      return `column ${it.column}: ${it.changes
        .map((c) =>
          c === 'type' ? `${it.target.type} → ${it.source.type}` : c === 'nullable' ? (it.source.nullable ? 'allow NULL' : 'NOT NULL') : `default ${it.target.default ?? 'none'} → ${it.source.default ?? 'none'}`
        )
        .join(', ')}`
    case 'index-added':
      return `${it.index.unique ? 'unique ' : ''}index (${it.index.columns.join(', ')})`
    case 'index-removed':
      return `index ${it.index.name} (only in the target)`
    case 'fk-added':
      return `foreign key (${it.fk.columns.join(', ')}) → ${it.fk.refTable}`
    case 'fk-removed':
      return `foreign key ${it.fk.name} (only in the target)`
    case 'pk-changed':
      return `primary key (${it.target.join(', ') || 'none'}) → (${it.source.join(', ') || 'none'})`
  }
}

function SidePicker({ label, side, onChange, connections }: { label: string; side: Side; onChange: (s: Side) => void; connections: ConnectionProfile[] }) {
  const md = useApp((s) => s.metadata[side.connectionId])
  useEffect(() => {
    if (side.connectionId) void ensureMetadata(side.connectionId)
  }, [side.connectionId])
  const conn = connections.find((c) => c.id === side.connectionId)
  return (
    <div className="field">
      <span className="lbl">
        {conn && <span className="dot" style={{ background: connectionAccent(conn) ?? 'var(--faint)', marginRight: 6 }} />}
        {label}
      </span>
      <div className="row">
        <select className="input" aria-label={`${label} data source`} value={side.connectionId} onChange={(e) => onChange({ connectionId: e.target.value, schema: '' })}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input" aria-label={`${label} schema`} value={side.schema || md?.defaultSchema || ''} onChange={(e) => onChange({ ...side, schema: e.target.value })}>
          {(md?.schemas ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/** Compare two schemas (e.g. staging → production) and open the migration for the target in a console. */
export function SchemaDiffDialog() {
  const connections = useApp((s) => s.connections)
  const metadata = useApp((s) => s.metadata)
  const [source, setSource] = useState<Side>(() => ({ connectionId: activeTab()?.connectionId ?? connections[0]?.id ?? '', schema: '' }))
  const [target, setTarget] = useState<Side>(() => {
    const other = connections.find((c) => c.id !== source.connectionId && c.environment === 'production') ?? connections.find((c) => c.id !== source.connectionId) ?? connections[0]
    return { connectionId: other?.id ?? '', schema: '' }
  })
  const [state, setState] = useState<{ status: 'idle' | 'reading' | 'done'; items: DiffItem[]; error?: string }>({ status: 'idle', items: [] })
  const schemaOf = (s: Side) => s.schema || metadata[s.connectionId]?.defaultSchema || ''
  const sourceConn = connections.find((c) => c.id === source.connectionId)
  const targetConn = connections.find((c) => c.id === target.connectionId)

  const compare = async () => {
    setState({ status: 'reading', items: [] })
    try {
      const [a, b] = await Promise.all([api.schemaSnapshot(source.connectionId, schemaOf(source)), api.schemaSnapshot(target.connectionId, schemaOf(target))])
      setState({ status: 'done', items: diffSchemas(a, b) })
    } catch (err) {
      setState({ status: 'idle', items: [], error: errorMessage(err) })
    }
  }

  const openMigration = async () => {
    if (!targetConn || !sourceConn) return
    const ddl = new Map<string, string>()
    for (const it of state.items) {
      if (it.kind !== 'table-added') continue
      try {
        ddl.set(it.table, await api.ddl(source.connectionId, 'table', schemaOf(source), it.table))
      } catch (err) {
        ddl.set(it.table, `-- ${it.table}: could not read its DDL (${errorMessage(err)})`)
      }
    }
    const header = `-- ${sourceConn.name} (${schemaOf(source)}) → ${targetConn.name} (${schemaOf(target)})${sourceConn.engine !== targetConn.engine ? `\n-- The engines differ (${sourceConn.engine} → ${targetConn.engine}): review types and CREATE TABLE statements.` : ''}\n`
    openConsole(target.connectionId, header + migrationSql(state.items, targetConn.engine, schemaOf(target), ddl), { name: 'migration', schema: schemaOf(target) })
    closeModal()
  }

  const byTable = useMemo(() => {
    const groups = new Map<string, DiffItem[]>()
    for (const it of state.items) groups.set(it.table, [...(groups.get(it.table) ?? []), it])
    return [...groups.entries()]
  }, [state.items])
  const count = (sign: '+' | '−' | '~') => state.items.filter((i) => SIGN[i.kind] === sign).length
  const same = source.connectionId === target.connectionId && schemaOf(source) === schemaOf(target)

  return (
    <Modal
      title="Compare schemas"
      wide
      onClose={closeModal}
      footer={
        <>
          <div className="left muted small">The migration opens in a console on the target. Nothing runs by itself, and drops come commented out.</div>
          <button className="btn" onClick={closeModal}>Close</button>
          <button className="btn primary" disabled={state.status !== 'done' || !state.items.length} onClick={() => void openMigration()}>
            Open migration in console
          </button>
        </>
      }
    >
      <div className="dialog-body fields">
        <div className="pair">
          <SidePicker label="Source (the way it should be)" side={source} onChange={setSource} connections={connections} />
          <SidePicker label="Target (what will change)" side={target} onChange={setTarget} connections={connections} />
        </div>
        <div className="row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn primary" disabled={!source.connectionId || !target.connectionId || same || state.status === 'reading'} onClick={() => void compare()}>
            <Icon name="refresh" /> Compare
          </button>
          {state.status === 'reading' && (
            <span className="muted small">
              <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Reading both schemas…
            </span>
          )}
          {same && <span className="muted small">Pick two different schemas.</span>}
          {state.status === 'done' && (
            <span className="diff-counts">
              <span className="add">+{count('+')}</span>
              <span className="chg">~{count('~')}</span>
              <span className="del">−{count('−')}</span>
            </span>
          )}
        </div>
        {state.error && <div className="banner error" style={{ borderRadius: 10 }}>{state.error}</div>}
        {state.status === 'done' && !state.items.length && <div className="empty" style={{ height: 'auto' }}>The schemas match.</div>}
        {byTable.length > 0 && (
          <div className="diff-list">
            {byTable.map(([table, items]) => (
              <section key={table}>
                <h3 className="mono">{table}</h3>
                {items.map((it, i) => (
                  <div key={i} className={`diff-row s${SIGN[it.kind] === '+' ? 'add' : SIGN[it.kind] === '~' ? 'chg' : 'del'}`}>
                    <span className="sign">{SIGN[it.kind]}</span>
                    <span className="mono">{describe(it)}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
