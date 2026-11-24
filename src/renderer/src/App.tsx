import { useEffect, useRef, useState } from 'react'
import { dispatch, flushControllers } from './actions'
import { api, errorMessage } from './api'
import { ContextMenuHost } from './components/ContextMenu'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Splitter } from './components/Splitter'
import { ConsoleTab } from './console/ConsoleTab'
import { ModalHost } from './dialogs/Dialogs'
import { applyTheme } from './theme'
import { resolveThemeId, themeById, THEMES, type Theme } from '@shared/themes'
import { Explorer } from './explorer/Explorer'
import { StatusBar, TabBar, Toasts, Toolbar, Welcome } from './shell/Shell'
import { handledByKeyboard, installKeymap } from './keys'
import { bootstrap, flushSession, focusPane, notify, setPrefs, setSplitRatio, useApp } from './store'
import { DdlTab } from './table/DdlTab'
import { TableTab } from './table/TableTab'

/** Applies the chosen theme (or a live preview while browsing themes); "system" follows macOS. */
function useTheme(): Theme {
  const pref = useApp((s) => s.prefs.theme)
  const preview = useApp((s) => s.themePreview)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme = themeById(preview ?? resolveThemeId(pref, systemDark)) ?? THEMES[0]
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  return theme
}

/** Double-Shift opens Search Everywhere (a gesture, not an accelerator). */
function useDoubleShift(): void {
  useEffect(() => {
    let last = 0
    let clean = true
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') clean = false
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      const now = Date.now()
      if (clean && now - last < 350) {
        last = 0
        if (!useApp.getState().modal) dispatch('search.everywhere')
      } else last = now
      clean = true
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [])
}

/**
 * Editor area with up to two splits. Every tab page is a sibling in one CSS grid and only its
 * grid-area says which split it belongs to — moving a tab between splits never remounts it,
 * so console results and editor state survive.
 */
function Workspace() {
  const { tabs, layout, connections } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const split = layout.panes.length === 2
  const row = layout.orientation === 'row'
  const a = `${layout.ratio}fr`
  const b = `${1 - layout.ratio}fr`
  const style: React.CSSProperties = !split
    ? { gridTemplateAreas: '"bar0" "c0"', gridTemplateRows: 'auto 1fr', gridTemplateColumns: '1fr' }
    : row
      ? { gridTemplateAreas: '"bar0 gut bar1" "c0 gut c1"', gridTemplateColumns: `minmax(0, ${a}) 1px minmax(0, ${b})`, gridTemplateRows: 'auto 1fr' }
      : { gridTemplateAreas: '"bar0" "c0" "gut" "bar1" "c1"', gridTemplateRows: `auto minmax(0, ${a}) 1px auto minmax(0, ${b})`, gridTemplateColumns: '1fr' }

  return (
    <div className={`workspace${split ? ' split' : ''}`} ref={ref} style={style}>
      {layout.panes.map((_, i) => (
        <div key={`bar${i}`} style={{ gridArea: `bar${i}`, minWidth: 0 }} onMouseDownCapture={() => focusPane(i)}>
          <TabBar pane={i} />
        </div>
      ))}
      {split && (
        <div
          className={`splitter ${row ? 'v' : 'h'}`}
          style={{ gridArea: 'gut' }}
          role="separator"
          onPointerDown={(e) => {
            const el = e.currentTarget
            el.setPointerCapture(e.pointerId)
            const box = ref.current!.getBoundingClientRect()
            const move = (ev: PointerEvent) => setSplitRatio(row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height)
            const up = () => {
              el.removeEventListener('pointermove', move)
              el.removeEventListener('pointerup', up)
            }
            el.addEventListener('pointermove', move)
            el.addEventListener('pointerup', up)
          }}
        />
      )}
      {tabs.length === 0 && (
        <div style={{ gridArea: 'c0', position: 'relative' }}>
          <Welcome />
        </div>
      )}
      {tabs.map((t) => {
        const i = Math.max(0, layout.panes.findIndex((p) => p.tabIds.includes(t.id)))
        const visible = layout.panes[i]?.activeId === t.id
        const focused = visible && layout.focused === i
        return (
          <div
            key={t.id}
            className={`tab-page${split && focused ? ' focused-split' : ''}${connections.find((c) => c.id === t.connectionId)?.environment === 'production' ? ' production' : ''}`}
            style={{ gridArea: `c${i}` }}
            hidden={!visible}
            role="tabpanel"
            onMouseDownCapture={() => focusPane(i)}
          >
            <ErrorBoundary label={t.title}>
              {t.kind === 'console' && <ConsoleTab tab={t} active={focused} />}
              {t.kind === 'table' && <TableTab tab={t} active={focused} />}
              {t.kind === 'ddl' && <DdlTab tab={t} />}
            </ErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}

export function App() {
  const { ready, showExplorer, prefs } = useApp()
  const [explorerWidth, setExplorerWidth] = useState(prefs.explorerWidth)
  const theme = useTheme()
  useDoubleShift()

  useEffect(() => {
    bootstrap()
      .then(() => setExplorerWidth(useApp.getState().prefs.explorerWidth))
      .catch((err) => notify('error', `Startup failed: ${errorMessage(err)}`))
    const onUnload = () => {
      flushControllers()
      flushSession()
    }
    window.addEventListener('beforeunload', onUnload)
    const uninstallKeymap = installKeymap()
    const offAction = api.onAction((id) => {
      // menu items must not act behind an open dialog, nor repeat a key the keymap already handled
      if ((useApp.getState().modal && !id.startsWith('search.')) || handledByKeyboard(id)) return
      dispatch(id)
    })
    return () => {
      offAction()
      uninstallKeymap()
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  if (!ready) return <div className="app" />
  return (
    <div className="app">
      <Toolbar dark={theme.dark} />
      <div className="main">
        {showExplorer && (
          <>
            <ErrorBoundary label="Database Explorer">
              <Explorer width={explorerWidth} />
            </ErrorBoundary>
            <Splitter direction="v" size={explorerWidth} min={180} max={640} onResize={setExplorerWidth} onCommit={(w) => setPrefs({ explorerWidth: w })} />
          </>
        )}
        <Workspace />
      </div>
      <StatusBar />
      <ErrorBoundary label="Dialog">
        <ModalHost />
      </ErrorBoundary>
      <ContextMenuHost />
      <Toasts />
    </div>
  )
}
