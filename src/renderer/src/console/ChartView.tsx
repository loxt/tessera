import { useEffect, useMemo, useRef, useState } from 'react'
import { buildSeries, guessChart, MAX_SERIES, niceTicks, numericColumns, type ChartType } from '@shared/chart'
import type { ResultSet } from '@shared/model'

const MIN_H = 160
const M = { top: 16, right: 20, bottom: 44, left: 64 }
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** Bar or line chart of the result in view: one X column, up to three numeric Y columns on one axis. */
export function ChartView({ result }: { result: ResultSet }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 300 })
  const width = size.width
  // fills the panel: the results area is resizable, the chart follows it
  const H = Math.max(MIN_H, size.height - 12)
  // the parent remounts the chart per result (key), so the first guess is taken once
  const [initial] = useState(() => guessChart(result))
  const [xPick, setX] = useState(initial.x)
  const [yPick, setYs] = useState(initial.ys)
  const [type, setType] = useState<ChartType>(initial.type)
  const [hover, setHover] = useState<number | null>(null)
  // a new page or filter keeps the columns, but never trust an index past them
  const x = xPick < result.columns.length ? xPick : 0
  const ys = yPick.filter((c) => c < result.columns.length && c !== x)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nums = useMemo(() => numericColumns(result), [result])
  const series = useMemo(() => buildSeries(result, x, ys), [result, x, ys])
  const all = series.values.flat().filter((v): v is number => v !== null)
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 5)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const plotW = Math.max(120, width - M.left - M.right)
  const plotH = H - M.top - M.bottom
  const n = series.labels.length
  const band = plotW / Math.max(1, n)
  const yAt = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH
  const xAt = (i: number) => M.left + band * i + band / 2
  const zeroY = yAt(Math.max(lo, Math.min(hi, 0)))
  // label every k-th category so names never collide
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))))
  const toggleY = (c: number) => setYs((cur) => (cur.includes(c) ? cur.filter((y) => y !== c) : cur.length < MAX_SERIES ? [...cur, c] : cur))

  const tooMany = n > 500
  return (
    <div className="chart-view">
      <div className="chart-controls">
        <div className="seg compact" role="radiogroup" aria-label="Chart type">
          {(['bar', 'line'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
              {t === 'bar' ? 'Bars' : 'Line'}
            </button>
          ))}
        </div>
        <label className="muted small" htmlFor="chart-x">X</label>
        <select id="chart-x" className="input" value={x} onChange={(e) => setX(Number(e.target.value))}>
          {result.columns.map((c, i) => (
            <option key={c.name + i} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="muted small">Y</span>
        {nums.filter((c) => c !== x).map((c) => {
          const slot = ys.indexOf(c)
          return (
            <button key={c} className={`chart-y${slot >= 0 ? ' on' : ''}`} aria-pressed={slot >= 0} disabled={slot < 0 && ys.length >= MAX_SERIES} title={slot < 0 && ys.length >= MAX_SERIES ? `Up to ${MAX_SERIES} series` : undefined} onClick={() => toggleY(c)}>
              {slot >= 0 && <i style={{ background: `var(--series-${slot + 1})` }} />}
              {result.columns[c].name}
            </button>
          )
        })}
        {series.summed && <span className="muted small">Repeated {result.columns[x].name} values are added up.</span>}
      </div>
      <div className="chart-plot" ref={box}>
        {!ys.length ? (
          <div className="empty">Pick a numeric column for Y.</div>
        ) : tooMany ? (
          <div className="empty">{n.toLocaleString()} points is too many to read; filter or group the query first.</div>
        ) : (
          <svg width={width} height={H} role="img" aria-label={`${type} chart of ${ys.map((c) => result.columns[c].name).join(', ')} by ${result.columns[x].name}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + plotW} y1={yAt(t)} y2={yAt(t)} className={t === 0 ? 'axis' : 'grid'} />
                <text x={M.left - 8} y={yAt(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {series.labels.map((l, i) =>
              i % every === 0 ? (
                <text key={i} x={xAt(i)} y={M.top + plotH + 18} className="tick" textAnchor="middle">
                  {l.length > 14 ? l.slice(0, 13) + '…' : l}
                </text>
              ) : null
            )}
            {type === 'bar'
              ? series.values.map((vals, s) => {
                  // side-by-side bars, 2px gap, rounded data end anchored at zero
                  const w = Math.max(2, (band * 0.72) / ys.length - 2)
                  return vals.map((v, i) => {
                    if (v === null) return null
                    const left = M.left + band * i + band * 0.14 + s * (w + 2)
                    const top = Math.min(yAt(v), zeroY)
                    const h = Math.max(1, Math.abs(yAt(v) - zeroY))
                    const r = Math.min(4, w / 2, h)
                    const up = v >= 0
                    const d = up
                      ? `M${left},${top + h} V${top + r} Q${left},${top} ${left + r},${top} H${left + w - r} Q${left + w},${top} ${left + w},${top + r} V${top + h} Z`
                      : `M${left},${top} V${top + h - r} Q${left},${top + h} ${left + r},${top + h} H${left + w - r} Q${left + w},${top + h} ${left + w},${top + h - r} V${top} Z`
                    return <path key={`${s}-${i}`} d={d} fill={`var(--series-${s + 1})`} opacity={hover === null || hover === i ? 1 : 0.45} />
                  })
                })
              : series.values.map((vals, s) => {
                  const pts = vals.map((v, i) => (v === null ? null : `${xAt(i)},${yAt(v)}`))
                  const d = pts.reduce<string>((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? ' L' : ' M'}${p}` : acc), '')
                  return <path key={s} d={d} fill="none" stroke={`var(--series-${s + 1})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                })}
            {hover !== null && (
              <g pointerEvents="none">
                {type === 'line' && <line x1={xAt(hover)} x2={xAt(hover)} y1={M.top} y2={M.top + plotH} className="crosshair" />}
                {type === 'line' &&
                  series.values.map((vals, s) =>
                    vals[hover] !== null ? <circle key={s} cx={xAt(hover)} cy={yAt(vals[hover]!)} r={4.5} fill={`var(--series-${s + 1})`} className="dot" /> : null
                  )}
              </g>
            )}
            {/* hit targets: a full-height column per category, wider than any mark */}
            {series.labels.map((_, i) => (
              <rect key={i} x={M.left + band * i} y={M.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
        )}
        {hover !== null && ys.length > 0 && !tooMany && (
          <div className="chart-tip" style={{ left: Math.min(xAt(hover) + 12, width - 200), top: M.top }}>
            <b>{series.labels[hover]}</b>
            {ys.map((c, s) => (
              <div key={c}>
                <i style={{ background: `var(--series-${s + 1})` }} />
                <span>{result.columns[c].name}</span>
                <span className="v">{series.values[s][hover] === null ? '—' : fmt(series.values[s][hover]!)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {ys.length > 1 && (
        <div className="chart-legend">
          {ys.map((c, s) => (
            <span key={c}>
              <i style={{ background: `var(--series-${s + 1})` }} />
              {result.columns[c].name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
