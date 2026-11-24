import { useState } from 'react'

interface Props {
  direction: 'v' | 'h'
  /** current size of the panel being resized */
  size: number
  min: number
  max: number
  /** +1 when dragging right/down grows the panel, -1 when it shrinks it */
  sign?: 1 | -1
  onResize: (size: number) => void
  onCommit?: (size: number) => void
}

/** Drag handle between panels. Uses pointer capture so drags never get lost over iframes/editors. */
export function Splitter({ direction, size, min, max, sign = 1, onResize, onCommit }: Props) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={`splitter ${direction}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={direction === 'v' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        setDragging(true)
        const start = direction === 'v' ? e.clientX : e.clientY
        let last = size
        const move = (ev: PointerEvent) => {
          const delta = ((direction === 'v' ? ev.clientX : ev.clientY) - start) * sign
          last = Math.min(max, Math.max(min, size + delta))
          onResize(last)
        }
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          setDragging(false)
          onCommit?.(last)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      }}
    />
  )
}
