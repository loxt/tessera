import { useMemo, useRef, useState } from 'react'
import { qualified, quoteIdent } from '@shared/dml'
import { connectionAccent } from '@shared/environment'
import type { ConnectionProfile, ConsoleFile, DbNode, Engine } from '@shared/model'
import { api, errorMessage } from '../api'
import { showMenu, type MenuEntry } from '../components/ContextMenu'
import { EnvBadge } from '../components/EnvBadge'
import { Icon } from '../components/Icon'
import { ENGINE_LABEL } from '../dialogs/ConnectionDialog'
import { sqlTemplate, type TemplateKind } from '../sqlgen'
import {
  confirm,
  consolesOf,
  deleteConnection,
  deleteConsole,
  disconnect,
  hideSchema,
  keyConnection,
  loadChildren,
  nodeKey,
  notify,
  openConsole,
  openDdl,
  openModal,
  openSavedConsole,
  openTable,
  refreshConnection,
  refreshConnections,
  renameConsole,
  selectNode,
  toggleExpanded,
  toggleRevealHidden,
  useApp
} from '../store'

type Row =
  | { type: 'group'; key: string; name: string; depth: number }
  | { type: 'conn'; key: string; conn: ConnectionProfile; depth: number }
  /** hidden: a hidden schema shown because the data source's hidden schemas are revealed */
  | { type: 'node'; key: string; node: DbNode; connId: string; depth: number; hidden?: boolean }
  | { type: 'hidden'; key: string; connId: string; count: number; revealed: boolean; depth: number }
  | { type: 'msg'; key: string; text: string; error?: boolean; retry?: string; depth: number }
  | { type: 'consoles'; key: string; connId: string; count: number; depth: number }
  | { type: 'console'; key: string; file: ConsoleFile; depth: number }

const ICON: Record<DbNode['kind'], string> = {
  schema: 'schema', folder: 'folder', table: 'table', view: 'view', routine: 'routine', sequence: 'sequence', column: 'column', index: 'index', key: 'key', fk: 'fk'
}

/** Folders are open by default, so their persisted state records collapse instead of expansion. */
const groupKey = (name: string) => `collapsed-group:${name}`

export function Explorer({ width }: { width: number }) {
  const { connections, children, loading, errors, expanded, selectedNode, connected, consoles, revealHidden } = useApp()
  const [filter, setFilter] = useState('')
  const treeRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const out: Row[] = []
    const needle = filter.trim().toLowerCase()
    const matches = (key: string, name: string): boolean =>
      !needle || name.toLowerCase().includes(needle) || (children[key] ?? []).some((n) => matches(nodeKey(keyConnection(key), n), n.name))
    /** `hiddenSchemas` only for a data source's top level, where the schemas are */
    const walk = (connId: string, parentKey: string, depth: number, hiddenSchemas = new Set<string>()) => {
      if (loading[parentKey] && !children[parentKey]) out.push({ type: 'msg', key: parentKey + '#loading', text: 'Loading…', depth })
      if (errors[parentKey]) out.push({ type: 'msg', key: parentKey + '#err', text: errors[parentKey]!, error: true, retry: parentKey, depth })
      const revealed = !!revealHidden[connId]
      let hiddenCount = 0
      for (const node of children[parentKey] ?? []) {
        const key = nodeKey(connId, node)
        const hidden = node.kind === 'schema' && hiddenSchemas.has(node.name)
        if (hidden) hiddenCount++
        if ((hidden && !revealed) || !matches(key, node.name)) continue
        out.push({ type: 'node', key, node, connId, depth, hidden })
        if (node.hasChildren && (expanded.includes(key) || (needle && children[key]))) walk(connId, key, depth + 1)
      }
      if (children[parentKey]?.length === 0) out.push({ type: 'msg', key: parentKey + '#empty', text: 'empty', depth })
      if (hiddenCount && !needle) out.push({ type: 'hidden', key: `${connId}::hidden-schemas`, connId, count: hiddenCount, revealed, depth })
    }
    const groups = new Map<string, ConnectionProfile[]>()
    for (const c of [...connections].sort((a, b) => a.name.localeCompare(b.name))) groups.set(c.group ?? '', [...(groups.get(c.group ?? '') ?? []), c])
    const ordered = [...groups].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    for (const [group, conns] of ordered) {
      const visible = conns.filter((c) => matches(c.id, c.name))
      if (!visible.length) continue
      if (group) {
        out.push({ type: 'group', key: `group:${group}`, name: group, depth: 0 })
        if (expanded.includes(groupKey(group)) && !needle) continue
      }
      for (const conn of visible) {
        const depth = group ? 1 : 0
        out.push({ type: 'conn', key: conn.id, conn, depth })
        if (!expanded.includes(conn.id)) continue
        // saved query consoles first, like DataGrip's console list per data source
        const mine = consolesOf(conn.id, consoles)
          .filter((c) => !needle || c.name.toLowerCase().includes(needle))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        const folderKey = `${conn.id}::consoles`
        if (mine.length) {
          out.push({ type: 'consoles', key: folderKey, connId: conn.id, count: mine.length, depth: depth + 1 })
          if (expanded.includes(folderKey) || needle) for (const file of mine) out.push({ type: 'console', key: `console:${file.id}`, file, depth: depth + 2 })
        }
        walk(conn.id, conn.id, depth + 1, new Set(conn.hiddenSchemas))
      }
    }
    return out
  }, [connections, children, loading, errors, expanded, filter, consoles, revealHidden])

  const selIndex = rows.findIndex((r) => r.key === selectedNode)
  const isOpen = (row: Row) => (row.type === 'group' ? !expanded.includes(groupKey(row.name)) : expanded.includes(row.key))
  const toggle = (row: Row, open?: boolean) => (row.type === 'group' ? toggleExpanded(groupKey(row.name), open === undefined ? undefined : !open) : toggleExpanded(row.key, open))

  const activate = (row: Row) => {
    if (row.type === 'conn' || row.type === 'group' || row.type === 'consoles') return toggle(row)
    if (row.type === 'console') return void openSavedConsole(row.file.id)
    if (row.type === 'hidden') return toggleRevealHidden(row.connId)
    if (row.type !== 'node') return
    const { node, connId } = row
    if ((node.kind === 'table' || node.kind === 'view') && node.path.schema) openTable(connId, node.path.schema, node.name)
    else if ((node.kind === 'routine' || node.kind === 'sequence') && node.path.schema) void showDdl(connId, node)
    else if (node.hasChildren) toggle(row)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[selIndex]
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (!r) return
      selectNode(r.key)
      treeRef.current?.querySelector(`[data-key="${CSS.escape(r.key)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'ArrowDown') return (e.preventDefault(), go(selIndex + 1))
    if (e.key === 'ArrowUp') return (e.preventDefault(), go(selIndex - 1))
    if (!row) return
    const expandable = row.type === 'conn' || row.type === 'group' || row.type === 'consoles' || (row.type === 'node' && row.node.hasChildren)
    if (e.key === 'ArrowRight' && expandable) return (e.preventDefault(), isOpen(row) ? go(selIndex + 1) : toggle(row, true))
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (expandable && isOpen(row)) return toggle(row, false)
      for (let i = selIndex - 1; i >= 0; i--) if (rows[i].depth < row.depth) return go(i)
    }
    if (e.key === 'Enter') return (e.preventDefault(), activate(row))
    if (e.key === 'F4' && row.type === 'node') return (e.preventDefault(), void showDdl(row.connId, row.node))
  }

  return (
    <div className="explorer" style={{ width }}>
      <div className="panel-head">
        <span className="title">Database Explorer</span>
        <button className="btn icon" title="New data source" onClick={(e) => showMenu(e, newSourceMenu())}>
          <Icon name="plus" />
        </button>
        <button className="btn icon" title="Refresh (⌘⌥Y)" disabled={!selectedNode} onClick={() => selectedNode && void refreshConnection(keyConnection(selectedNode))}>
          <Icon name="refresh" />
        </button>
        <button className="btn icon" title="Collapse all" onClick={() => useApp.setState((s) => ({ expanded: s.expanded.filter((k) => k.startsWith('collapsed-group:')) }))}>
          <Icon name="minus" />
        </button>
      </div>
      {connections.length > 0 && (
        <div className="filter-box">
          <input className="input" placeholder="Filter loaded objects…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFilter('')} />
        </div>
      )}
      {connections.length === 0 ? (
        <div className="empty">
          <Icon name="database" />
          <div>No data sources yet.</div>
          <div className="actions">
            {(['postgres', 'mysql', 'sqlite'] as Engine[]).map((e) => (
              <button key={e} className="btn" onClick={() => openModal({ kind: 'connection', initial: { engine: e } })}>
                <Icon name="plus" /> {ENGINE_LABEL[e]}
              </button>
            ))}
            <button className="btn" onClick={() => openModal({ kind: 'connection' })}>
              <Icon name="search" /> From URL…
            </button>
          </div>
        </div>
      ) : (
        <div className="tree" ref={treeRef} tabIndex={0} role="tree" aria-label="Database Explorer" onKeyDown={onKeyDown}>
          {rows.map((row) => (
            <TreeRow
              key={row.key}
              row={row}
              selected={row.key === selectedNode}
              open={isOpen(row)}
              connected={row.type === 'conn' && !!connected[row.conn.id]}
              onToggle={() => toggle(row)}
              onActivate={() => activate(row)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TreeRow({ row, selected, open, connected, onToggle, onActivate }: { row: Row; selected: boolean; open: boolean; connected: boolean; onToggle: () => void; onActivate: () => void }) {
  if (row.type === 'msg') {
    return (
      <div className={`tree-msg${row.error ? ' error' : ' muted'}`} style={{ paddingLeft: 24 + row.depth * 16 }}>
        {row.text}
        {row.retry && (
          <button className="btn" style={{ height: 20, marginLeft: 6 }} onClick={() => void loadChildren(row.retry!)}>
            Retry
          </button>
        )}
      </div>
    )
  }
  const expandable = row.type === 'group' || row.type === 'conn' || row.type === 'consoles' || (row.type === 'node' && row.node.hasChildren)
  return (
    <div
      data-key={row.key}
      className={`tree-row${row.type === 'conn' ? ' conn' : ''}${selected ? ' selected' : ''}${row.type === 'node' && row.hidden ? ' dimmed' : ''}`}
      style={{ paddingLeft: 4 + row.depth * 16 }}
      role="treeitem"
      aria-expanded={expandable ? open : undefined}
      aria-selected={selected}
      onMouseDown={() => selectNode(row.key)}
      onClick={row.type === 'hidden' ? onActivate : undefined}
      onDoubleClick={row.type === 'hidden' ? undefined : onActivate}
      onContextMenu={(e) => {
        selectNode(row.key)
        const items = menuFor(row)
        if (items.length) showMenu(e, items)
      }}
    >
      <span
        className="twist"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {expandable && <Icon name={open ? 'chevronDown' : 'chevronRight'} />}
      </span>
      {row.type === 'group' && (
        <>
          <Icon name="folder" />
          <span className="name">{row.name}</span>
        </>
      )}
      {row.type === 'conn' && (
        <>
          {connectionAccent(row.conn) && <span className="color-bar" style={{ background: connectionAccent(row.conn) }} />}
          <Icon name="database" />
          <span className="name">{row.conn.name}</span>
          <span className="detail">
            {ENGINE_LABEL[row.conn.engine]}
            {row.conn.readOnly ? ' · read-only' : ''}
          </span>
          {connected && <span className="dot" title="connected" style={{ background: 'var(--success)', width: 6, height: 6 }} />}
          {row.conn.environment === 'production' && <EnvBadge env="production" />}
        </>
      )}
      {row.type === 'node' && (
        <>
          <Icon name={ICON[row.node.kind]} />
          <span className="name">{row.node.name}</span>
          {row.hidden ? <span className="detail">hidden</span> : row.node.detail && <span className="detail">{row.node.detail}</span>}
        </>
      )}
      {row.type === 'hidden' && (
        <>
          <Icon name="eye" />
          <span className="name muted">
            {row.count} hidden schema{row.count === 1 ? '' : 's'}
          </span>
          <span className="detail">{row.revealed ? 'click to hide' : 'click to show'}</span>
        </>
      )}
      {row.type === 'consoles' && (
        <>
          <Icon name="folder" />
          <span className="name">consoles</span>
          <span className="detail">{row.count}</span>
        </>
      )}
      {row.type === 'console' && (
        <>
          <Icon name="console" />
          <span className="name">{row.file.name}</span>
          <span className="detail">{firstLine(row.file.text)}</span>
        </>
      )}
    </div>
  )
}

const firstLine = (text: string) => text.trim().split('\n')[0]?.slice(0, 60) ?? ''

function newSourceMenu(): MenuEntry[] {
  return [
    ...(['postgres', 'mysql', 'sqlite'] as Engine[]).map((e) => ({ label: ENGINE_LABEL[e], run: () => openModal({ kind: 'connection', initial: { engine: e } }) })),
    'separator' as const,
    { label: 'From URL…', run: () => openModal({ kind: 'connection' }) }
  ]
}

async function showDdl(connId: string, node: DbNode): Promise<void> {
  if (!node.path.schema) return
  try {
    await openDdl(connId, `${node.name}.sql`, api.ddl(connId, node.kind, node.path.schema, node.name))
  } catch (err) {
    notify('error', errorMessage(err))
  }
}

/** Destructive explorer actions always show the exact statement before running it. */
async function runAdmin(connId: string, title: string, sql: string): Promise<void> {
  const ok = await confirm(title, 'This statement will be executed immediately:', [
    { label: 'Execute', value: 'ok', danger: true },
    { label: 'Cancel', value: 'cancel', primary: true }
  ], sql)
  if (ok !== 'ok') return
  const res = await api.execute(`admin:${connId}`, connId, sql, {})
  if (res.error) return notify('error', res.error.message)
  notify('success', `${title}: done`)
  await refreshConnection(connId)
}

async function generate(connId: string, engine: Engine, schema: string, table: string, kind: TemplateKind): Promise<void> {
  try {
    const info = await api.tableInfo(connId, schema, table)
    openConsole(connId, sqlTemplate(kind, info, engine))
  } catch (err) {
    notify('error', errorMessage(err))
  }
}

function connectionMenu(c: ConnectionProfile): MenuEntry[] {
  return [
    { label: 'New Query Console', run: () => openConsole(c.id) },
    {
      label: 'Open Query Console…',
      shortcut: '⌘⇧L',
      disabled: !consolesOf(c.id).length,
      run: () => openModal({ kind: 'palette', mode: 'consoles', connectionId: c.id })
    },
    { label: 'Refresh', shortcut: '⌘⌥Y', run: () => void refreshConnection(c.id) },
    { label: 'Properties…', shortcut: '⌘I', run: () => openModal({ kind: 'connection', editId: c.id }) },
    {
      label: 'Duplicate',
      run: () =>
        void api
          .duplicateConnection(c.id)
          .then(refreshConnections)
          .catch((err) => notify('error', errorMessage(err)))
    },
    'separator',
    { label: 'Disconnect', run: () => void disconnect(c.id) },
    {
      label: 'Delete Data Source…',
      danger: true,
      run: async () => {
        const ok = await confirm('Delete data source', `Delete "${c.name}"? Its tabs will be closed and its saved password removed.`, [
          { label: 'Delete', value: 'ok', danger: true },
          { label: 'Cancel', value: 'cancel', primary: true }
        ])
        if (ok === 'ok') await deleteConnection(c.id)
      }
    }
  ]
}

function menuFor(row: Row): MenuEntry[] {
  const copy = (text: string) => void api.copyText(text).catch((err) => notify('error', errorMessage(err)))
  if (row.type === 'conn') return connectionMenu(row.conn)
  if (row.type === 'consoles') return [{ label: 'New Query Console', run: () => openConsole(row.connId) }]
  if (row.type === 'console') {
    return [
      { label: 'Open', shortcut: '↩', run: () => void openSavedConsole(row.file.id) },
      { label: 'Rename…', run: () => void renameConsole(row.file.id) },
      { label: 'Copy SQL', run: () => copy(row.file.text) },
      'separator',
      { label: 'Delete Console…', danger: true, run: () => void deleteConsole(row.file.id) }
    ]
  }
  if (row.type !== 'node') return []
  const { node, connId } = row
  const engine = useApp.getState().connections.find((c) => c.id === connId)?.engine
  const schema = node.path.schema
  if (!engine) return []
  if (node.kind === 'schema') {
    return [
      { label: 'New Query Console', run: () => openConsole(connId, '', { schema: node.name }) },
      { label: 'Refresh', run: () => void loadChildren(row.key) },
      { label: 'Copy Name', run: () => copy(node.name) },
      'separator',
      row.hidden
        ? { label: 'Unhide Schema', run: () => void hideSchema(connId, node.name, false) }
        : { label: 'Hide Schema', run: () => void hideSchema(connId, node.name, true) }
    ]
  }
  if ((node.kind === 'table' || node.kind === 'view') && schema) {
    const full = qualified(schema, node.name, engine)
    const dropKind = node.kind === 'table' ? 'TABLE' : node.detail === 'materialized' ? 'MATERIALIZED VIEW' : 'VIEW'
    return [
      { label: 'Open Data', shortcut: '↩', run: () => openTable(connId, schema, node.name) },
      { label: 'Show DDL', shortcut: 'F4', run: () => void showDdl(connId, node) },
      { label: 'Show Relationships', run: () => openModal({ kind: 'diagram', connectionId: connId, schema, table: node.name }) },
      { label: 'Import Data…', run: () => openModal({ kind: 'import', connectionId: connId, schema, table: node.name }) },
      'separator',
      ...(['select', 'insert', 'update', 'delete'] as TemplateKind[]).map((k) => ({ label: `Generate ${k.toUpperCase()}`, run: () => void generate(connId, engine, schema, node.name, k) })),
      'separator',
      { label: 'Copy Name', run: () => copy(node.name) },
      { label: 'Copy Qualified Name', run: () => copy(full) },
      'separator',
      ...(node.kind === 'table' ? [{ label: 'Truncate…', danger: true, run: () => void runAdmin(connId, 'Truncate table', engine === 'sqlite' ? `DELETE FROM ${full}` : `TRUNCATE TABLE ${full}`) }] : []),
      { label: 'Drop…', danger: true, run: () => void runAdmin(connId, `Drop ${node.kind}`, `DROP ${dropKind} ${full}`) }
    ]
  }
  if ((node.kind === 'routine' || node.kind === 'sequence') && schema) {
    return [
      { label: 'Show DDL', shortcut: 'F4', run: () => void showDdl(connId, node) },
      { label: 'Copy Name', run: () => copy(node.name) },
      ...(node.kind === 'sequence' ? [{ label: 'Drop…', danger: true, run: () => void runAdmin(connId, 'Drop sequence', `DROP SEQUENCE ${qualified(schema, node.name, engine)}`) }] : [])
    ]
  }
  return [{ label: 'Copy Name', run: () => copy(node.kind === 'column' ? quoteIdent(node.name, engine) : node.name) }]
}
