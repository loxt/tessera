import { dispatch, focusedConnectionId } from '../actions'
import { showMenu } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { Logo } from '../components/Logo'
import { ENGINE_LABEL } from '../dialogs/ConnectionDialog'
import { EnvBadge } from '../components/EnvBadge'
import { connectionAccent, environmentLabel, type Environment } from '@shared/environment'
import { activate, closeTab, dismissToast, keyLabel, moveTabToOtherSplit, openConsole, openModal, openSavedConsole, renameConsole, splitTab, unsplitPanes, useApp } from '../store'
import { TaskIndicator } from './TaskIndicator'

const key = keyLabel

export function Toolbar({ dark }: { dark: boolean }) {
  // re-render when selection/tabs change so "Console" enables correctly
  useApp((s) => [s.selectedNode, s.activeTabId, s.connections.length].join('|'))
  return (
    <div className="toolbar">
      <span className="brand">
        <Logo size={20} />
        Tessera
      </span>
      <button className="btn icon" title={`Database Explorer (${key('view.toggleExplorer')})`} onClick={() => dispatch('view.toggleExplorer')}>
        <Icon name="sidebar" />
      </button>
      <div className="sep" />
      <button className="btn outline" title="New data source" onClick={() => dispatch('connection.new')}>
        <Icon name="plus" /> New Data Source
      </button>
      <button className="btn primary" title={`New query console (${key('console.new')})`} disabled={!focusedConnectionId()} onClick={() => dispatch('console.new')}>
        <Icon name="console" /> New Console
      </button>
      <span className="spacer" />
      <button className="search-pill" onClick={() => dispatch('search.everywhere')}>
        <Icon name="search" /> <span className="grow">Search everywhere</span> <span className="kbd">⇧⇧</span>
      </button>
      <button className="btn icon" title="Choose theme" onClick={() => dispatch('view.chooseTheme')}>
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      <button className="btn icon" title={`Settings (${key('settings.open')})`} onClick={() => dispatch('settings.open')}>
        <Icon name="gear" />
      </button>
    </div>
  )
}

export function TabBar({ pane = 0 }: { pane?: number }) {
  const { tabs: allTabs, layout, connections, dirty } = useApp()
  const ids = layout.panes[pane]?.tabIds ?? []
  const tabs = ids.map((id) => allTabs.find((t) => t.id === id)).filter((t) => !!t)
  const activeTabId = layout.panes[pane]?.activeId
  const split = layout.panes.length === 2
  if (!tabs.length) return null
  return (
    <div className={`tabbar${split && layout.focused === pane ? ' focused-split' : ''}`} role="tablist">
      {tabs.map((t) => {
        const conn = connections.find((c) => c.id === t.connectionId)
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeTabId}
            className={`tab${t.id === activeTabId ? ' active' : ''}`}
            title={`${t.title} — ${conn?.name ?? ''}`}
            onMouseDown={(e) => (e.button === 1 ? void closeTab(t.id) : activate(t.id))}
            onDoubleClick={() => t.kind === 'console' && void renameConsole(t.consoleId)}
            onContextMenu={(e) =>
              showMenu(e, [
                ...(t.kind === 'console' ? [{ label: 'Rename Console…', run: () => void renameConsole(t.consoleId) }, 'separator' as const] : []),
                { label: 'Split Right', shortcut: key('view.splitRight'), run: () => splitTab('row', t.id) },
                { label: 'Split Down', shortcut: key('view.splitDown'), run: () => splitTab('column', t.id) },
                ...(split
                  ? [
                      { label: 'Move to Opposite Split', shortcut: key('tab.moveToOtherSplit'), run: () => moveTabToOtherSplit(t.id) },
                      { label: 'Unsplit', shortcut: key('view.unsplit'), run: () => unsplitPanes() }
                    ]
                  : []),
                'separator',
                { label: 'Close', shortcut: key('tab.close'), run: () => void closeTab(t.id) },
                { label: 'Close Others', run: () => tabs.filter((x) => x.id !== t.id).forEach((x) => void closeTab(x.id)) },
                { label: 'Close All', run: () => tabs.forEach((x) => void closeTab(x.id)) }
              ])
            }
          >
            {conn && connectionAccent(conn) && <span className="color-line" style={{ background: connectionAccent(conn) }} />}
            <Icon name={t.kind === 'table' ? 'table' : t.kind === 'ddl' ? 'ddl' : 'console'} />
            <span className="label">{t.title}</span>
            {t.kind === 'console' && conn && <span className="muted small label">{conn.name}</span>}
            {dirty[t.id] && <span className="dirty" title={dirty[t.id] === 'transaction' ? 'open transaction' : 'pending changes'}>●</span>}
            <button
              className="btn icon close"
              aria-label="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void closeTab(t.id)
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

const WELCOME_KEYS: [string, string][] = [
  ['Search everywhere', '⇧⇧'],
  ['New query console', 'console.new'],
  ['Execute statement', 'query.execute'],
  ['Find action', 'search.actions'],
  ['Go to table', 'search.tables'],
  ['Query history', 'query.history']
]

const RECENT_CONSOLES = 5
const ENV_ORDER: (Environment | undefined)[] = ['production', 'staging', 'local', undefined]
const ENV_TITLE = (env: Environment | undefined) => (env ? environmentLabel(env) : 'No environment')

function timeAgo(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`
}

/** A data source card opens its most recent console, or a new one. */
function openFirstConsole(connectionId: string): void {
  const last = [...useApp.getState().consoles].filter((c) => c.connectionId === connectionId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (last) openSavedConsole(last.id)
  else openConsole(connectionId)
}

/** Empty workspace: data sources by environment, recent consoles, the keys worth knowing. */
export function Welcome() {
  const { connections, consoles } = useApp()
  const groups = ENV_ORDER.map((env) => ({ env, items: connections.filter((c) => c.environment === env) })).filter((g) => g.items.length)
  const recent = [...consoles].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_CONSOLES)
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <header className="welcome-head">
          <Logo size={40} />
          <div>
            <h1>Data sources</h1>
            <p className="muted">Pick up where you left off, or connect something new.</p>
          </div>
          <span className="grow" />
          <button className="btn primary" onClick={() => dispatch('connection.new')}>
            <Icon name="plus" /> New data source
          </button>
        </header>

        {groups.length === 0 && (
          <div className="welcome-empty">
            <p>Nothing connected yet. Tessera works with PostgreSQL, MySQL / MariaDB and SQLite.</p>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.env ?? 'none'} className="welcome-group">
            <h2>
              <span className="env-dot" style={{ background: g.env ? `var(--env-${g.env})` : 'var(--faint)' }} /> {ENV_TITLE(g.env)}
            </h2>
            <div className="source-grid">
              {g.items.map((c) => (
                <button
                  key={c.id}
                  className="source-card"
                  style={{ borderTopColor: connectionAccent(c) ?? 'var(--border)' }}
                  onClick={() => openFirstConsole(c.id)}
                >
                  <span className="source-top">
                    <b>{c.name}</b>
                    <span className="mono muted">{ENGINE_LABEL[c.engine]}</span>
                  </span>
                  <span className="mono muted source-host">{c.engine === 'sqlite' ? c.file : `${c.host ?? ''}${c.port ? `:${c.port}` : ''}/${c.database ?? ''}`}</span>
                  <span className="source-meta">
                    {consoles.filter((x) => x.connectionId === c.id).length} consoles
                    {c.readOnly && <span className="chip">read-only</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <div className="welcome-cols">
          {recent.length > 0 && (
            <section className="welcome-recent">
              <h2>Recent consoles</h2>
              {recent.map((r) => {
                const conn = connections.find((c) => c.id === r.connectionId)
                return (
                  <button key={r.id} className="recent-row" onClick={() => openSavedConsole(r.id)}>
                    <span className="env-dot" style={{ background: (conn && connectionAccent(conn)) ?? 'var(--faint)' }} />
                    <b>{r.name}</b>
                    <code className="mono muted">{r.text.replace(/\s+/g, ' ').trim() || 'empty'}</code>
                    <span className="muted small">{timeAgo(r.updatedAt)}</span>
                  </button>
                )
              })}
            </section>
          )}
          <section className="welcome-keys">
            <h2>Keys worth knowing</h2>
            {WELCOME_KEYS.map(([label, id]) => (
              <div key={label} className="key-row">
                <span>{label}</span>
                <kbd className="key">{id.includes('.') ? key(id) : id}</kbd>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}

export function StatusBar() {
  const { tabs, activeTabId, connections, connected, dirty, loading, notifications, prefs } = useApp()
  const tab = tabs.find((t) => t.id === activeTabId)
  const conn = connections.find((c) => c.id === tab?.connectionId)
  const busy = Object.values(loading).some(Boolean)
  const errors = notifications.filter((n) => n.kind === 'error').length
  return (
    <div className="statusbar">
      {conn ? (
        <span className="item">
          {conn.environment ? (
            <EnvBadge env={conn.environment} />
          ) : (
            <span className="dot" style={{ background: connectionAccent(conn) ?? (connected[conn.id] ? 'var(--success)' : 'var(--faint)') }} />
          )}
          {conn.name} · {ENGINE_LABEL[conn.engine]}
          {conn.readOnly ? ' · read-only' : ''} · {connected[conn.id] ? 'connected' : 'not connected'}
        </span>
      ) : (
        <span className="item">No data source</span>
      )}
      {tab && dirty[tab.id] === 'transaction' && <span className="item" style={{ color: 'var(--warn)' }}>● transaction open</span>}
      {tab?.kind === 'console' && <span className="item">Tx: {tab.autoCommit ? 'Auto' : 'Manual'}</span>}
      <span className="grow" />
      <TaskIndicator />
      {busy && (
        <span className="item">
          <span className="spinner" /> Introspecting…
        </span>
      )}
      <span className="item">page {prefs.pageSize}</span>
      <span className="item clickable" role="button" onClick={() => openModal({ kind: 'notifications' })} title="Notifications">
        <Icon name="bell" /> {errors > 0 && <span style={{ color: 'var(--danger)' }}>{errors}</span>}
      </span>
    </div>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="ticon">
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} />
          </span>
          <span className="msg">{t.message}</span>
          {t.action && (
            <button
              className="btn outline"
              onClick={() => {
                dismissToast(t.id)
                t.action!.run()
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn icon" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  )
}
