import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'

export type MenuEntry =
  | { label: string; run: () => void; shortcut?: string; disabled?: boolean; danger?: boolean }
  | 'separator'

const useMenu = create<{ menu: { x: number; y: number; items: MenuEntry[] } | null }>(() => ({ menu: null }))

export function showMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuEntry[]): void {
  e.preventDefault()
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, items } })
}

const hide = () => useMenu.setState({ menu: null })

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // keep the menu inside the window
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 4), y: Math.min(menu.y, window.innerHeight - r.height - 4) })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', hide)
    }
  }, [menu])

  if (!menu) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onMouseDown={hide} onContextMenu={(e) => (e.preventDefault(), hide())}>
      <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {menu.items.map((it, i) =>
          it === 'separator' ? (
            <div key={i} className="ctx-sep" />
          ) : (
            <div
              key={i}
              role="menuitem"
              aria-disabled={it.disabled}
              className={`ctx-item${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}`}
              onClick={() => {
                if (it.disabled) return
                hide()
                it.run()
              }}
            >
              <span className="grow">{it.label}</span>
              {it.shortcut && <span className="muted small">{it.shortcut}</span>}
            </div>
          )
        )}
      </div>
    </div>
  )
}
