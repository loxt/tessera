import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cellText } from '@shared/export'
import { isJsonCell } from '@shared/json'
import type { CellValue, ColumnMeta } from '@shared/model'
import { Icon } from '../components/Icon'
import { trackGrid } from '../scoped'

const ROW = 30
const HEAD = 36
const OVERSCAN = 8

export interface CellPos {
  r: number
  c: number
}
export type CellState = 'edited' | 'inserted' | 'deleted' | undefined

export interface GridHandle {
  /** actual row indexes touched by the selection */
  selectedRows(): number[]
  /** actual (row, column) pairs of the selection */
  selectedCells(): CellPos[]
  /** Commits an open cell editor; returns the edit so callers can use it before React re-renders. */
  commitEdit(): { r: number; c: number; value: CellValue } | null
  toggleViewer(): void
  focus(): void
}

interface Props {
  columns: ColumnMeta[]
  rowCount: number
  getValue: (r: number, c: number) => CellValue | undefined
  getState?: (r: number, c: number) => CellState
  hidden?: number[]
  editable?: boolean
  onEdit?: (cells: CellPos[], value: CellValue) => void
  sort?: { col: number; dir: 'asc' | 'desc' } | null
  onSort?: (col: number) => void
  onCellMenu?: (e: React.MouseEvent, pos: CellPos | null) => void
  /** table-level grid actions (grid.addRow, grid.submit…); return false when not applicable */
  onCommand?: (actionId: string) => boolean
  rowNumberOffset?: number
  /** change to reset scroll + selection (new query result, new page) */
  resetKey?: unknown
  handleRef?: React.Ref<GridHandle>
  /** row of the focused cell, null when nothing is selected (drives the record panel) */
  onFocusRow?: (r: number | null) => void
  /** every selected cell after each selection change (drives the footer summary) */
  onSelectionChange?: (cells: CellPos[]) => void
  /** shows a filter button in each header; called with the column and the button's position */
  onFilterColumn?: (col: number, anchor: DOMRect) => void
  /** columns with an active filter (their button stays highlighted) */
  filteredColumns?: ReadonlySet<number>
  /** shows a JSON button in cells that hold JSON */
  onOpenJson?: (pos: CellPos) => void
}

const NUMERIC = /int|numeric|decimal|float|double|real|serial|money|number/i

/** is (r, vc) inside the rectangle spanned by a selection's anchor and focus? */
const within = (s: { anchor: CellPos; focus: CellPos }, r: number, vc: number) =>
  r >= Math.min(s.anchor.r, s.focus.r) && r <= Math.max(s.anchor.r, s.focus.r) && vc >= Math.min(s.anchor.c, s.focus.c) && vc <= Math.max(s.anchor.c, s.focus.c)

export function formatCell(v: CellValue | undefined): string {
  if (v === undefined) return '<default>'
  if (v === null) return '<null>'
  if (typeof v === 'object') return `0x${v.hex.slice(0, 40).toUpperCase()}${v.hex.length > 40 ? '…' : ''}  (${v.size} B)`
  const s = String(v)
  return (s.length > 400 ? s.slice(0, 400) + '…' : s).replace(/\r?\n/g, '↵')
}

/** room for the header filter button */
const FILTER_BUTTON = 26

function initialWidths(columns: ColumnMeta[], rowCount: number, getValue: Props['getValue'], extra = 0): number[] {
  return columns.map((col, c) => {
    // header shows "name type": keep room for both (type is rendered smaller)
    let chars = col.name.length + 2 + col.type.length * 0.8
    for (let r = 0; r < Math.min(rowCount, 60); r++) chars = Math.max(chars, formatCell(getValue(r, c)).length)
    return Math.round(Math.min(380 + extra, Math.max(56, chars * 7.4 + 18) + extra))
  })
}

export function DataGrid(props: Props) {
  const { columns, rowCount, getValue, getState, editable, onEdit, sort, onSort, onCellMenu, onCommand, rowNumberOffset = 0, resetKey } = props
  const ref = useRef<HTMLDivElement>(null)
  const visCols = useMemo(() => columns.map((_, i) => i).filter((i) => !props.hidden?.includes(i)), [columns, props.hidden])
  const [widths, setWidths] = useState<number[]>(() => initialWidths(columns, rowCount, getValue, props.onFilterColumn ? FILTER_BUTTON : 0))
  const [sel, setSel] = useState<{ anchor: CellPos; focus: CellPos } | null>(null)
  const [editing, setEditing] = useState<{ pos: CellPos; text: string } | null>(null)
  const [viewer, setViewer] = useState(false)
  const [scroll, setScroll] = useState({ top: 0, height: 400 })
  const dragging = useRef(false)
  const cancelled = useRef(false)

  const focusRow = sel?.focus.r ?? null
  const onFocusRow = props.onFocusRow
  useEffect(() => {
    onFocusRow?.(focusRow)
  }, [focusRow, onFocusRow])

  // new result → fresh widths, scroll and selection
  useEffect(() => {
    setWidths(initialWidths(columns, rowCount, getValue, props.onFilterColumn ? FILTER_BUTTON : 0))
    setSel(null)
    setEditing(null)
    if (ref.current) ref.current.scrollTop = ref.current.scrollLeft = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, resetKey])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, height: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rnWidth = Math.max(44, String(rowCount + rowNumberOffset).length * 8 + 18)
  const offsets = useMemo(() => {
    const out: number[] = []
    let x = rnWidth
    for (const c of visCols) {
      out.push(x)
      x += widths[c] ?? 100
    }
    out.push(x)
    return out
  }, [visCols, widths, rnWidth])
  const totalWidth = offsets[offsets.length - 1]

  const rect = sel && {
    r0: Math.min(sel.anchor.r, sel.focus.r),
    r1: Math.max(sel.anchor.r, sel.focus.r),
    c0: Math.min(sel.anchor.c, sel.focus.c),
    c1: Math.max(sel.anchor.c, sel.focus.c)
  }
  const inSel = (r: number, vc: number) => !!rect && r >= rect.r0 && r <= rect.r1 && vc >= rect.c0 && vc <= rect.c1
  const selBeforeClick = useRef<typeof sel>(null)
  const selectedCells = (): CellPos[] => {
    if (!rect) return []
    const out: CellPos[] = []
    for (let r = rect.r0; r <= rect.r1; r++) for (let vc = rect.c0; vc <= rect.c1; vc++) out.push({ r, c: visCols[vc] })
    return out
  }

  const onSelectionChange = props.onSelectionChange
  useEffect(() => {
    onSelectionChange?.(selectedCells())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect?.r0, rect?.r1, rect?.c0, rect?.c1, visCols, onSelectionChange])

  const ensureVisible = (p: CellPos) => {
    const el = ref.current
    if (!el) return
    const top = HEAD + p.r * ROW
    if (top - HEAD < el.scrollTop) el.scrollTop = top - HEAD
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
    const left = offsets[p.c]
    const right = offsets[p.c + 1]
    if (left - rnWidth < el.scrollLeft) el.scrollLeft = left - rnWidth
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }

  const moveTo = (p: CellPos, extend: boolean) => {
    const q = { r: Math.max(0, Math.min(rowCount - 1, p.r)), c: Math.max(0, Math.min(visCols.length - 1, p.c)) }
    if (rowCount === 0) return
    setSel((s) => (extend && s ? { anchor: s.anchor, focus: q } : { anchor: q, focus: q }))
    ensureVisible(q)
  }

  const canEdit = (p: CellPos) => editable && getState?.(p.r, visCols[p.c]) !== 'deleted'
  /**
   * Like DataGrip: editing a cell inside a multi-cell selection edits every selected cell.
   * Deleted rows and binary cells are skipped. One cell (or an edit outside the selection) → [].
   */
  const bulkTargets = (pos: CellPos): CellPos[] => {
    if (!rect || !inSel(pos.r, pos.c) || (rect.r0 === rect.r1 && rect.c0 === rect.c1)) return []
    return selectedCells().filter((p) => {
      const v = getValue(p.r, p.c)
      return getState?.(p.r, p.c) !== 'deleted' && !(v !== null && typeof v === 'object')
    })
  }
  const startEdit = (p: CellPos, text?: string) => {
    if (!canEdit(p)) return
    const v = getValue(p.r, visCols[p.c])
    if (v !== null && typeof v === 'object') return // binary: not editable inline
    cancelled.current = false
    setEditing({ pos: p, text: text ?? (v === null || v === undefined ? '' : String(v)) })
  }
  const commitEdit = (move?: CellPos) => {
    // Escape → focus() → blur fires with the stale `editing`; the flag makes that blur a no-op
    if (!editing || cancelled.current) {
      cancelled.current = false
      return null
    }
    const { pos, text } = editing
    const targets = bulkTargets(pos)
    const before = getValue(pos.r, visCols[pos.c])
    const unchanged = (before === null || before === undefined ? '' : String(before)) === text
    // bulk: the typed value goes into every selected cell, even where the focused one already had it
    const edit = unchanged && targets.length < 2 ? null : { r: pos.r, c: visCols[pos.c], value: text }
    if (edit) onEdit?.(targets.length > 1 ? targets : [{ r: edit.r, c: edit.c }], text)
    cancelled.current = true // the blur caused by focus() below must not commit twice
    setEditing(null)
    // after a bulk edit the selection stays, so the user sees (and can revert) what changed
    if (move && targets.length < 2) moveTo(move, false)
    ref.current?.focus()
    cancelled.current = false
    return edit
  }

  const bulkCount = editing ? bulkTargets(editing.pos).length : 0

  useImperativeHandle(props.handleRef, () => ({
    selectedRows: () => (rect ? Array.from({ length: rect.r1 - rect.r0 + 1 }, (_, i) => rect.r0 + i) : []),
    selectedCells,
    commitEdit: () => commitEdit() ?? null,
    toggleViewer: () => setViewer((v) => !v),
    focus: () => ref.current?.focus()
  }))

  /** Keymap entry point for grid-scoped actions while this grid has focus. */
  const command = (id: string): boolean => {
    if (editing) commitEdit()
    if (id === 'grid.viewer') return setViewer((v) => !v), true
    if (id === 'grid.setNull') {
      if (!editable || !sel) return false
      onEdit?.(selectedCells().filter((p) => getState?.(p.r, p.c) !== 'deleted'), null)
      return true
    }
    return onCommand?.(id) ?? false
  }
  const commandRef = useRef(command)
  commandRef.current = command
  const untrack = useRef<(() => void) | null>(null)
  useEffect(() => () => untrack.current?.(), [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    const meta = e.metaKey || e.ctrlKey
    const f = sel?.focus ?? { r: 0, c: 0 }
    const page = Math.max(1, Math.floor(scroll.height / ROW) - 2)
    const nav: Record<string, CellPos> = {
      ArrowDown: { r: meta ? rowCount - 1 : f.r + 1, c: f.c },
      ArrowUp: { r: meta ? 0 : f.r - 1, c: f.c },
      ArrowRight: { r: f.r, c: meta ? visCols.length - 1 : f.c + 1 },
      ArrowLeft: { r: f.r, c: meta ? 0 : f.c - 1 },
      PageDown: { r: f.r + page, c: f.c },
      PageUp: { r: f.r - page, c: f.c },
      Home: { r: meta ? 0 : f.r, c: 0 },
      End: { r: meta ? rowCount - 1 : f.r, c: visCols.length - 1 }
    }
    if (nav[e.key]) {
      e.preventDefault()
      return moveTo(sel ? nav[e.key] : { r: 0, c: 0 }, e.shiftKey)
    }
    if (meta && e.key === 'a') {
      e.preventDefault()
      return setSel({ anchor: { r: 0, c: 0 }, focus: { r: rowCount - 1, c: visCols.length - 1 } })
    }
    // command shortcuts (add/clone/delete row, set NULL, viewer, submit…) come from the keymap via `command`
    if (!sel) return
    if ((e.key === 'Enter' || e.key === 'F2') && !meta && !e.shiftKey) return (e.preventDefault(), startEdit(f))
    if (e.key === 'Escape') return setViewer(false)
    if (!meta && !e.altKey && e.key.length === 1 && editable) {
      e.preventDefault()
      startEdit(f, e.key)
    }
  }

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !rect) return
    e.preventDefault()
    const lines: string[] = []
    for (let r = rect.r0; r <= rect.r1; r++) {
      const cells: string[] = []
      for (let vc = rect.c0; vc <= rect.c1; vc++) cells.push(cellText(getValue(r, visCols[vc]) ?? null).replace(/[\t\r\n]/g, ' '))
      lines.push(cells.join('\t'))
    }
    e.clipboardData.setData('text/plain', lines.join('\n'))
  }

  const first = Math.max(0, Math.floor(scroll.top / ROW) - OVERSCAN)
  const last = Math.min(rowCount, Math.ceil((scroll.top + scroll.height) / ROW) + OVERSCAN)
  const rows = []
  for (let r = first; r < last; r++) {
    rows.push(
      <div key={r} className="grid-row" style={{ top: HEAD + r * ROW, width: totalWidth }}>
        <div
          className="gcell rownum"
          style={{ width: rnWidth }}
          onMouseDown={(e) => {
            ref.current?.focus()
            const row = { anchor: { r: e.shiftKey && sel ? sel.anchor.r : r, c: 0 }, focus: { r, c: visCols.length - 1 } }
            setSel(row)
            e.preventDefault()
          }}
        >
          {r < rowCount ? r + 1 + rowNumberOffset : ''}
        </div>
        {visCols.map((c, vc) => {
          const v = getValue(r, c)
          const state = getState?.(r, c)
          const numeric = typeof v === 'number' || NUMERIC.test(columns[c].type)
          const json = !!props.onOpenJson && isJsonCell(columns[c].type, v)
          const cls = [
            'gcell',
            numeric && 'num',
            json && 'has-json',
            v === null && 'null',
            v === undefined && 'default',
            v !== null && typeof v === 'object' && 'bin',
            inSel(r, vc) && 'sel',
            sel?.focus.r === r && sel.focus.c === vc && 'focus',
            state
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={c}
              className={cls}
              style={{ width: widths[c] }}
              onMouseDown={(e) => {
                if (e.button !== 0) return
                ref.current?.focus()
                // the first click of a double-click collapsed a multi-cell selection; when the double-click
                // lands inside it, bring it back so the edit applies to every selected cell (bulk edit)
                const before = selBeforeClick.current
                if (e.detail === 2 && !e.shiftKey && before && within(before, r, vc)) {
                  setSel(before)
                  e.preventDefault()
                  return
                }
                selBeforeClick.current = sel
                dragging.current = true
                setSel((s) => (e.shiftKey && s ? { anchor: s.anchor, focus: { r, c: vc } } : { anchor: { r, c: vc }, focus: { r, c: vc } }))
                e.preventDefault()
              }}
              onMouseEnter={() => dragging.current && setSel((s) => (s ? { anchor: s.anchor, focus: { r, c: vc } } : s))}
              onDoubleClick={() => startEdit({ r, c: vc })}
              onContextMenu={(e) => {
                if (!inSel(r, vc)) setSel({ anchor: { r, c: vc }, focus: { r, c: vc } })
                onCellMenu?.(e, { r, c })
              }}
            >
              {json ? (
                <>
                  <span className="ctext">{formatCell(v)}</span>
                  <button
                    className="json-btn"
                    title="View JSON"
                    aria-label="View JSON"
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onOpenJson?.({ r, c })
                    }}
                  >
                    <Icon name="braces" />
                  </button>
                </>
              ) : (
                formatCell(v)
              )}
            </div>
          )
        })}
      </div>
    )
  }

  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const focusVal = sel ? getValue(sel.focus.r, visCols[sel.focus.c]) : undefined
  return (
    <div className="grid-wrap">
      <div
        ref={ref}
        className="grid"
        tabIndex={0}
        onFocus={() => {
          untrack.current?.()
          untrack.current = trackGrid((id) => commandRef.current(id))
        }}
        role="grid"
        aria-rowcount={rowCount}
        aria-colcount={visCols.length}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onContextMenu={(e) => e.target === e.currentTarget && onCellMenu?.(e, null)}
      >
        <div className="grid-inner" style={{ width: totalWidth, height: HEAD + rowCount * ROW }}>
          <div className="grid-head" style={{ width: totalWidth }}>
            <div className="gcell rownum" style={{ width: rnWidth }} />
            {visCols.map((c) => (
              <div key={c} className="gcell" style={{ width: widths[c] }} title={`${columns[c].name} ${columns[c].type}`} onClick={() => onSort?.(c)}>
                <span className="cname">{columns[c].name}</span>
                <span className="ctype">{columns[c].type}</span>
                {sort?.col === c && <span className="sort">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                {props.onFilterColumn && (
                  <button
                    className={`hfilter${props.filteredColumns?.has(c) ? ' on' : ''}`}
                    title={`Filter ${columns[c].name}`}
                    aria-label={`Filter ${columns[c].name}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onFilterColumn?.(c, e.currentTarget.getBoundingClientRect())
                    }}
                  >
                    <Icon name="filter" />
                  </button>
                )}
                <span
                  className="resize"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    const el = e.currentTarget
                    el.setPointerCapture(e.pointerId)
                    const start = e.clientX
                    const w0 = widths[c]
                    const move = (ev: PointerEvent) => setWidths((ws) => ws.map((w, i) => (i === c ? Math.max(40, w0 + ev.clientX - start) : w)))
                    const up = () => {
                      el.removeEventListener('pointermove', move)
                      el.removeEventListener('pointerup', up)
                    }
                    el.addEventListener('pointermove', move)
                    el.addEventListener('pointerup', up)
                  }}
                />
              </div>
            ))}
          </div>
          {rows}
          {editing && bulkCount > 1 && (
            <span
              className="bulk-badge"
              style={{ left: offsets[editing.pos.c] + widths[visCols[editing.pos.c]] + 4, top: HEAD + editing.pos.r * ROW }}
            >
              → {bulkCount} cells
            </span>
          )}
          {editing && (
            <input
              aria-label={bulkCount > 1 ? `Value for ${bulkCount} selected cells` : 'Cell value'}
              className="cell-editor"
              autoFocus
              value={editing.text}
              style={{ left: offsets[editing.pos.c], top: HEAD + editing.pos.r * ROW - 1, width: widths[visCols[editing.pos.c]] + 1, height: ROW + 2 }}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onBlur={() => commitEdit()}
              onKeyDown={(e) => {
                e.stopPropagation()
                const p = editing.pos
                if (e.key === 'Enter' && !e.metaKey) (e.preventDefault(), commitEdit({ r: p.r + 1, c: p.c }))
                else if (e.key === 'Tab') (e.preventDefault(), commitEdit({ r: p.r, c: p.c + (e.shiftKey ? -1 : 1) }))
                else if (e.key === 'Escape') {
                  cancelled.current = true
                  setEditing(null)
                  ref.current?.focus()
                }
              }}
            />
          )}
        </div>
      </div>
      {viewer && (
        <ValueViewer
          key={sel ? `${sel.focus.r}:${sel.focus.c}` : 'none'}
          value={focusVal}
          column={sel ? columns[visCols[sel.focus.c]] : undefined}
          editable={!!sel && !!canEdit(sel.focus) && !(focusVal !== null && typeof focusVal === 'object')}
          onApply={(text) => sel && onEdit?.([{ r: sel.focus.r, c: visCols[sel.focus.c] }], text)}
          onClose={() => setViewer(false)}
        />
      )}
    </div>
  )
}

function ValueViewer({
  value,
  column,
  editable,
  onApply,
  onClose
}: {
  value: CellValue | undefined
  column?: ColumnMeta
  editable: boolean
  onApply: (text: string) => void
  onClose: () => void
}) {
  const initial = useMemo(() => {
    if (value === undefined) return ''
    if (value === null) return ''
    if (typeof value === 'object') return value.hex.replace(/(.{2})/g, '$1 ').trim()
    const s = String(value)
    if (/^\s*[[{]/.test(s)) {
      try {
        return JSON.stringify(JSON.parse(s), null, 2)
      } catch {
        return s
      }
    }
    return s
  }, [value])
  const [text, setText] = useState(initial)
  return (
    <div className="value-viewer">
      <div className="panel-head">
        <span className="title">{column ? `${column.name} · ${column.type}` : 'Value'}</span>
        {value === null && <span className="muted small">NULL</span>}
        <button className="btn icon" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
      <textarea className="input" readOnly={!editable} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 6px 6px' }}>
          <button className="btn primary" disabled={text === initial} onClick={() => onApply(text)}>Apply</button>
        </div>
      )}
    </div>
  )
}
