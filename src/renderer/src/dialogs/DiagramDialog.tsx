import { useEffect, useState } from 'react'
import type { CompletionTable } from '@shared/model'
import { neighborhood, type Edge } from '@shared/relations'
import { Icon } from '../components/Icon'
import { closeModal, ensureMetadata, openTable, useApp } from '../store'
import { Modal } from './Dialogs'

const BOX_W = 230
const HEAD = 34
const ROW = 22
const GAP = 22
const COL_GAP = 120
const MAX_ROWS = 12

interface Box {
  table: CompletionTable
  x: number
  y: number
  /** columns drawn: the first MAX_ROWS plus every column an edge uses */
  columns: string[]
  more: number
}

function boxFor(table: CompletionTable, x: number, y: number, edges: Edge[]): Box {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]).filter((p) => p.table === table.name).map((p) => p.column))
  const shown = table.columns.filter((c, i) => i < MAX_ROWS || linked.has(c))
  return { table, x, y, columns: shown, more: table.columns.length - shown.length }
}
const heightOf = (b: Box) => HEAD + (b.columns.length + (b.more ? 1 : 0)) * ROW + 8

/** Stacks boxes down a column, returning them and the column height. */
function stack(tables: CompletionTable[], x: number, edges: Edge[]): { boxes: Box[]; height: number } {
  let y = 0
  const boxes = tables.map((t) => {
    const b = boxFor(t, x, y, edges)
    y += heightOf(b) + GAP
    return b
  })
  return { boxes, height: Math.max(0, y - GAP) }
}

/** A table, the tables it references (left) and the ones that reference it (right), wired column to column. */
export function DiagramDialog({ connectionId, schema, table }: { connectionId: string; schema: string; table: string }) {
  const md = useApp((s) => s.metadata[connectionId])
  const [history, setHistory] = useState([table])
  const focusName = history[history.length - 1]
  useEffect(() => {
    void ensureMetadata(connectionId)
  }, [connectionId])
  const n = md ? neighborhood(md, schema, focusName) : null

  let body: React.ReactNode = <div className="empty">Loading the schema…</div>
  if (md && !n) body = <div className="empty">{focusName} is not in the loaded schema.</div>
  if (n) {
    const left = stack(n.parents, 0, n.edges)
    const centerX = n.parents.length ? BOX_W + COL_GAP : 0
    const center = stack([n.focus], centerX, n.edges)
    const rightX = centerX + BOX_W + COL_GAP
    const right = stack(n.children, rightX, n.edges)
    const height = Math.max(left.height, center.height, right.height)
    // center each column vertically
    const shift = (s: { boxes: Box[]; height: number }) => s.boxes.map((b) => ({ ...b, y: b.y + (height - s.height) / 2 }))
    const boxes = [...shift(left), ...shift(center), ...shift(right)]
    const width = (n.children.length ? rightX + BOX_W : centerX + BOX_W) + 60
    const at = (p: Edge['from']) => {
      const b = boxes.find((x) => x.table.name === p.table)
      if (!b) return null
      const i = b.columns.indexOf(p.column)
      return { b, y: b.y + HEAD + (i < 0 ? 0 : i) * ROW + ROW / 2 }
    }
    const linked = new Set(n.edges.flatMap((e) => [`${e.from.table}.${e.from.column}`, `${e.to.table}.${e.to.column}`]))
    body = (
      <div className="diagram-scroll">
        <svg width={width} height={height + 40} className="diagram">
          <g transform="translate(30, 20)">
            {n.edges.map((e, i) => {
              const a = at(e.from)
              const b = at(e.to)
              if (!a || !b) return null
              if (a.b === b.b) {
                // self reference: a loop on the right edge
                const x = a.b.x + BOX_W
                return <path key={i} d={`M${x},${a.y} C${x + 50},${a.y} ${x + 50},${b.y} ${x},${b.y}`} className="edge" markerEnd="url(#arrow)" />
              }
              const leftToRight = a.b.x < b.b.x
              const x1 = leftToRight ? a.b.x + BOX_W : a.b.x
              const x2 = leftToRight ? b.b.x : b.b.x + BOX_W
              const mid = (x1 + x2) / 2
              return <path key={i} d={`M${x1},${a.y} C${mid},${a.y} ${mid},${b.y} ${x2},${b.y}`} className="edge" markerEnd="url(#arrow)" />
            })}
            {boxes.map((b) => {
              const isFocus = b.table === n.focus
              return (
                <g key={b.table.name} transform={`translate(${b.x}, ${b.y})`} className={`entity${isFocus ? ' focus' : ''}`} onClick={() => !isFocus && setHistory((h) => [...h, b.table.name])}>
                  <title>{isFocus ? b.table.name : `Center on ${b.table.name}`}</title>
                  <rect width={BOX_W} height={heightOf(b)} rx={12} className="box" />
                  {/* one path rounded at the top only: two overlapping rects double a translucent fill */}
                  <path d={`M0,${HEAD} V12 Q0,0 12,0 H${BOX_W - 12} Q${BOX_W},0 ${BOX_W},12 V${HEAD} Z`} className="head" />
                  <text x={14} y={HEAD / 2 + 1} className="title" dominantBaseline="middle">
                    {b.table.name.length > 26 ? b.table.name.slice(0, 25) + '…' : b.table.name}
                  </text>
                  {b.columns.map((c, i) => (
                    <text key={c} x={14} y={HEAD + i * ROW + ROW / 2 + 4} className={`col${linked.has(`${b.table.name}.${c}`) ? ' linked' : ''}`} dominantBaseline="middle">
                      {c.length > 30 ? c.slice(0, 29) + '…' : c}
                    </text>
                  ))}
                  {b.more > 0 && (
                    <text x={14} y={HEAD + b.columns.length * ROW + ROW / 2 + 4} className="col more" dominantBaseline="middle">
                      +{b.more} more
                    </text>
                  )}
                </g>
              )
            })}
          </g>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" className="arrow" />
            </marker>
          </defs>
        </svg>
        {!n.parents.length && !n.children.length && !n.edges.length && <div className="muted small" style={{ padding: 12 }}>{n.focus.name} has no foreign keys in or out.</div>}
      </div>
    )
  }

  return (
    <Modal
      title={`Relationships · ${focusName}`}
      wide
      className="diagram-dialog"
      onClose={closeModal}
      footer={
        <>
          <div className="left">
            <button className="btn" disabled={history.length < 2} onClick={() => setHistory((h) => h.slice(0, -1))}>
              <Icon name="chevronLeft" /> Back
            </button>
            <span className="muted small">Left: tables {focusName} points to. Right: tables pointing to it. Click one to center it.</span>
          </div>
          <button
            className="btn primary"
            onClick={() => {
              closeModal()
              openTable(connectionId, schema, focusName)
            }}
          >
            Open {focusName}
          </button>
        </>
      }
    >
      <div className="dialog-body">{body}</div>
    </Modal>
  )
}
