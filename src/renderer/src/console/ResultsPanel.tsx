import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CellValue, Engine, ExecResult, ExportSource, PlanNode, ResultSet, TableInfo } from '@shared/model'
import { generateDml, inlineParams } from '@shared/dml'
import { cellText, EXPORT_FORMATS, exportResult, rowMatches, sortedSql, type ExportFormat } from '@shared/export'
import { formatDuration, SLOW_MS } from '@shared/history'
import { showMenu } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { api, errorMessage } from '../api'
import { DataGrid, type CellPos, type GridHandle } from '../grid/DataGrid'
import { ColumnFilter, filterKey } from '../grid/ColumnFilter'
import { Pager } from '../grid/Pager'
import { SelectionSummary } from '../grid/SelectionSummary'
import { cellState, changeCount, displayValue, editCell, EMPTY, isEmpty, revertAll, revertRows, toChangeSet, type PendingChanges } from '../grid/changes'
import { notify, openModal, reviewChanges, useApp } from '../store'
import { singleTableSource, whyReadOnly } from './editable'
import { RecordPanel } from '../table/RecordPanel'
import { AiPanel } from './AiPanel'
import { ChartView } from './ChartView'
import { CompareView } from './CompareView'
import { PlanView } from './PlanView'
import type { AiEntry } from './useAi'

export interface OutputLine {
  at: number
  kind: 'info' | 'ok' | 'error' | 'sql'
  text: string
}

export interface ResultTab {
  id: string
  title: string
  sql: string
  params?: CellValue[]
  result: ResultSet
  durationMs: number
  /** first row of the page shown (console paging re-runs the statement wrapped in LIMIT/OFFSET) */
  offset?: number
  /** from Count; null until counted */
  total?: number | null
  /** results of "Run on several data sources": where it ran, on its own session */
  connectionId?: string
  sessionId?: string
  /** dot color on the tab (the data source's environment or color) */
  accent?: string
}

interface Props {
  engine: Engine
  outputs: OutputLine[]
  results: ResultTab[]
  plan: PlanNode[] | null
  active: string
  onActivate: (id: string) => void
  onFetchAll: (r: ResultTab) => void
  onPage: (r: ResultTab, offset: number, size?: number) => void
  onCount: (r: ResultTab) => void
  /** what an export re-runs to get every row of a result, or undefined when the statement is not safe to re-run */
  exportSource: (r: ResultTab) => ExportSource | undefined
  onClose: () => void
  ai: AiEntry[]
  aiRunning: boolean
  onAiInsert: (sql: string) => void
  onAiReplace: (entry: AiEntry, sql: string) => void
  onAiCancel: (id: string) => void
  onAiClear: () => void
  onAnalyzePlan?: () => void
  /** snapshots kept across runs, to compare a later result against */
  pinned: ResultTab[]
  onPin: (r: ResultTab) => void
  onUnpin: (id: string) => void
  compare: { baseId: string; otherId: string } | null
  onCompare: (baseId: string, otherId: string) => void
  /** what editing a result needs; results of single-table SELECTs become editable (double-click a cell) */
  editing?: Editing
}

export interface Editing {
  /** the console's session: in Manual mode the changes join its open transaction */
  sessionId: string
  connectionId: string
  /** schema for unqualified table names */
  defaultSchema?: string
  readOnly: boolean
  production: boolean
  onApplied: (res: ExecResult) => void
}

/** Loads the table behind a single-table SELECT and says whether its result can be edited. */
function useEditTarget(tab: ResultTab, engine: Engine, editing: Editing | undefined, isPinned: boolean): { info: TableInfo | null; reason: string | null } {
  const [state, setState] = useState<{ info: TableInfo | null; reason: string | null }>({ info: null, reason: null })
  const connectionId = editing?.connectionId
  const readOnly = editing?.readOnly
  const defaultSchema = editing?.defaultSchema
  useEffect(() => {
    setState({ info: null, reason: null })
    if (!connectionId) return
    if (isPinned) return setState({ info: null, reason: 'pinned snapshot' })
    if (readOnly) return setState({ info: null, reason: 'read-only data source' })
    const src = singleTableSource(tab.sql, engine)
    const schema = src?.schema ?? defaultSchema
    if (!src || !schema) return setState({ info: null, reason: 'not a single-table SELECT' })
    let live = true
    api
      .tableInfo(connectionId, schema, src.table)
      .then((info) => live && setState({ info, reason: whyReadOnly(tab.result.columns, info) }))
      .catch((err) => live && setState({ info: null, reason: errorMessage(err) }))
    return () => {
      live = false
    }
  }, [tab, engine, connectionId, readOnly, defaultSchema, isPinned])
  return state
}

type Sort = { col: number; dir: 'asc' | 'desc' } | null

const compare = (a: CellValue, b: CellValue): number => {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = Number(a)
  const nb = Number(b)
  if (typeof a === 'string' && typeof b === 'string' && a.trim() !== '' && b.trim() !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return cellText(a).localeCompare(cellText(b))
}

type ColumnFilters = ReadonlyMap<number, ReadonlySet<string>>

/** row indexes after the grid's client-side filters (text and per-column values) and sort */
function arrange(rows: CellValue[][], filter: string, sort: Sort, columns: ColumnFilters): number[] {
  const needle = filter.toLowerCase()
  let idx = rows.map((_, i) => i)
  if (needle) idx = idx.filter((i) => rowMatches(rows[i], needle))
  for (const [col, keep] of columns) idx = idx.filter((i) => keep.has(filterKey(rows[i][col])))
  if (sort) idx.sort((x, y) => compare(rows[x][sort.col], rows[y][sort.col]) * (sort.dir === 'asc' ? 1 : -1))
  return idx
}

const COPY_FORMATS = EXPORT_FORMATS

interface ViewProps {
  tab: ResultTab
  engine: Engine
  source?: ExportSource
  onFetchAll: () => void
  onPage: (offset: number, size?: number) => void
  onCount: () => void
  /** this result is a pinned snapshot: no paging, no re-run */
  isPinned: boolean
  pinned: ResultTab[]
  onPin: () => void
  onCompare: (baseId: string) => void
  editing?: Editing
}

function ResultView({ tab, engine, source, onFetchAll, onPage, onCount, isPinned, pinned, onPin, onCompare, editing }: ViewProps) {
  const pageSize = useApp((s) => s.prefs.pageSize)
  const [colFilters, setColFilters] = useState<ColumnFilters>(new Map())
  const [filtering, setFiltering] = useState<{ col: number; anchor: DOMRect } | null>(null)
  const [sort, setSort] = useState<Sort>(null)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<CellPos[]>([])
  const [recordOpen, setRecordOpen] = useState(false)
  const [chartOpen, setChartOpen] = useState(false)
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const grid = useRef<GridHandle>(null)
  // a new statement starts clean; a new page of the same one keeps the view
  useEffect(() => {
    setSort(null)
    setColFilters(new Map())
  }, [tab.id])

  // Rows as last submitted (a successful submit shows the new values without re-running the query)
  // and pending edits, both tied to the result they belong to: a new result starts clean in the very
  // render it arrives, so nothing downstream (e.g. the chart picking its type) sees the previous rows.
  const [submitted, setSubmitted] = useState<{ tab: ResultTab; rows: CellValue[][] } | null>(null)
  const [edits, setEdits] = useState<{ tab: ResultTab; pending: PendingChanges } | null>(null)
  const rows = submitted?.tab === tab ? submitted.rows : tab.result.rows
  const pending = edits?.tab === tab ? edits.pending : EMPTY
  const setRows = (next: CellValue[][]) => setSubmitted({ tab, rows: next })
  const setPending = (next: PendingChanges | ((p: PendingChanges) => PendingChanges)) =>
    setEdits((e) => {
      const current = e?.tab === tab ? e.pending : EMPTY
      return { tab, pending: typeof next === 'function' ? next(current) : next }
    })
  const target = useEditTarget(tab, engine, editing, isPinned)
  const editable = !!target.info && !target.reason
  const changes = changeCount(pending)

  const order = useMemo(() => arrange(rows, filter, sort, colFilters), [rows, sort, filter, colFilters])
  const filteredCols = useMemo(() => new Set(colFilters.keys()), [colFilters])
  const chartResult = useMemo(() => ({ ...tab.result, rows: order.map((r) => rows[r]) }), [tab, rows, order])
  const getValue = useCallback((r: number, c: number) => (order[r] === undefined ? undefined : displayValue(pending, rows, order[r], c)), [rows, order, pending])
  const getState = useCallback((r: number, c: number) => (order[r] === undefined ? undefined : cellState(pending, rows.length, order[r], c)), [rows, order, pending])
  const edit = (cells: CellPos[], value: CellValue) => setPending((p) => cells.reduce((acc, cell) => editCell(acc, rows, order[cell.r], cell.c, value), p))

  const submit = async () => {
    const open = grid.current?.commitEdit()
    const current = open ? editCell(pending, rows, order[open.r], open.c, open.value) : pending
    if (!editing || !target.info || isEmpty(current)) return
    let cs
    let preview: string
    try {
      cs = toChangeSet(current, target.info, tab.result.columns, rows)
      preview = generateDml(cs, engine).map((s) => inlineParams(s.sql, s.params, engine) + ';').join('\n')
    } catch (err) {
      return notify('error', errorMessage(err))
    }
    if (!(await reviewChanges(preview, editing.production, engine))) return
    try {
      const res = await api.applyChanges(editing.sessionId, editing.connectionId, cs)
      editing.onApplied(res)
      if (res.error) return notify('error', `Changes were rolled back: ${res.error.message}`)
      setRows(rows.map((row, r) => row.map((_, c) => displayValue(current, rows, r, c) ?? null)))
      setPending(EMPTY)
    } catch (err) {
      notify('error', errorMessage(err))
    }
  }

  /** the selected rows when more than one is selected, otherwise every row in view */
  const rowsInScope = () => {
    const picked = grid.current?.selectedRows() ?? []
    return picked.length > 1 ? picked.map((r) => rows[order[r]]) : order.map((r) => rows[r])
  }
  const copyAs = async (format: ExportFormat, label: string) => {
    const rows = rowsInScope()
    try {
      await api.copyText(exportResult({ ...tab.result, rows }, format, { engine }))
      notify('success', `Copied ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'} as ${label}`)
    } catch (err) {
      notify('error', `Copy failed: ${errorMessage(err)}`)
    }
  }

  // like DataGrip: a result cut by the fetch limit is re-run in full at export time; a multi-row selection exports as-is
  const exportData = () => {
    const picked = grid.current?.selectedRows() ?? []
    if (picked.length > 1) return openModal({ kind: 'export', result: { ...tab.result, rows: picked.map((r) => rows[order[r]]) }, engine })
    // the full re-run keeps the grid's view: quick filter per streamed batch, sort pushed into the SQL
    const full = tab.result.hasMore && source?.kind === 'sql' ? source : undefined
    openModal({
      kind: 'export',
      result: { ...tab.result, rows: order.map((r) => rows[r]) },
      engine,
      source: full && { ...full, sql: sort ? sortedSql(full.sql, engine, sort.col, sort.dir, tab.result.columns.map((c) => c.name)) : full.sql, filter: filter || undefined }
    })
  }

  const slow = tab.durationMs >= SLOW_MS
  return (
    <>
      {chartOpen ? (
        <ChartView key={tab.id} result={chartResult} />
      ) : (
      <div className="table-body">
      <DataGrid
        handleRef={grid}
        columns={tab.result.columns}
        rowCount={order.length}
        getValue={getValue}
        getState={getState}
        editable={editable}
        onEdit={edit}
        sort={sort}
        resetKey={tab}
        onFocusRow={setFocusRow}
        onSelectionChange={setSelection}
        rowNumberOffset={tab.offset ?? 0}
        filteredColumns={filteredCols}
        onFilterColumn={(col, anchor) => setFiltering({ col, anchor })}
        onOpenJson={(p) => openModal({ kind: 'json', title: `${tab.result.columns[p.c].name} · row ${(tab.offset ?? 0) + p.r + 1}`, text: String(getValue(p.r, p.c) ?? '') })}
        onSort={(col) => setSort((s) => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null))}
        onCommand={(id) => {
          if (id === 'grid.export') exportData()
          else if (id === 'grid.submit' && editable) void submit()
          else if (id === 'grid.revert' && editable) setPending((p) => revertRows(p, (grid.current?.selectedRows() ?? []).map((r) => order[r]), rows.length))
          else return false
          return true
        }}
        onCellMenu={(e) =>
          showMenu(e, [
            { label: 'Copy', shortcut: '⌘C', run: () => document.execCommand('copy') },
            { label: 'Value Viewer', shortcut: '⇧↩', run: () => grid.current?.toggleViewer() },
            { label: 'Open Record', run: () => setRecordOpen(true) },
            'separator',
            ...COPY_FORMATS.map((f) => ({ label: `Copy as ${f.label}`, run: () => void copyAs(f.id, f.label) })),
            'separator',
            { label: 'Export Data…', run: exportData }
          ])
        }
      />
      {filtering && (
        <ColumnFilter
          anchor={filtering.anchor}
          column={tab.result.columns[filtering.col].name}
          values={tab.result.rows.map((row) => row[filtering.col])}
          selected={colFilters.get(filtering.col) ?? null}
          onClose={() => setFiltering(null)}
          onApply={(keep) => {
            const next = new Map(colFilters)
            if (keep) next.set(filtering.col, keep)
            else next.delete(filtering.col)
            setColFilters(next)
            setFiltering(null)
          }}
        />
      )}
      {recordOpen && (
        <RecordPanel
          columns={tab.result.columns}
          hidden={[]}
          info={editable ? target.info : null}
          title={tab.title}
          row={focusRow !== null && focusRow < order.length ? focusRow : null}
          rowLabel={focusRow !== null ? (tab.offset ?? 0) + focusRow + 1 : null}
          getValue={getValue}
          getState={getState}
          editable={editable}
          readOnlyHint={`Read-only: ${target.reason ?? "loading"}. Results of a single-table SELECT that include the primary key can be edited.`}
          onEdit={(r, c, value) => edit([{ r, c }], value)}
          onFollow={() => undefined}
          onClose={() => setRecordOpen(false)}
        />
      )}
      </div>
      )}
      <div className="grid-foot">
        <span className={`run-chip${slow ? ' slow' : ''}`} title={tab.sql}>
          <Icon name={slow ? 'alert' : 'check'} />
          {formatDuration(tab.durationMs)}
        </span>
        {isPinned ? (
          <span className="filter-chip" style={{ paddingRight: 12 }}>
            <Icon name="pin" /> Pinned snapshot
          </span>
        ) : (
        <Pager
          offset={tab.offset ?? 0}
          pageSize={pageSize}
          rows={tab.result.rows.length}
          hasMore={tab.result.hasMore}
          total={tab.total ?? null}
          disabledReason={source ? undefined : 'Paging re-runs the statement, so it is only available for read-only queries'}
          onPage={(o) => onPage(o)}
          onPageSize={(n) => onPage(Math.floor((tab.offset ?? 0) / n) * n, n)}
          onCount={onCount}
        />
        )}
        {tab.result.hasMore && source && !isPinned && (
          <button className="btn outline" onClick={onFetchAll} title="Re-run without the fetch limit">
            Fetch all
          </button>
        )}
        {(filter || colFilters.size > 0) && (
          <span className="filter-chip">
            {order.length.toLocaleString()} of {tab.result.rows.length.toLocaleString()} shown
            {colFilters.size > 0 && (
              <button className="btn icon" title="Remove column filters" aria-label="Remove column filters" onClick={() => setColFilters(new Map())}>
                <Icon name="close" />
              </button>
            )}
          </span>
        )}
        <SelectionSummary cells={selection} getValue={getValue} />
        <span className="grow" />
        {changes > 0 ? (
          <>
            <span className="pending-note">
              {changes} pending change{changes === 1 ? '' : 's'}
            </span>
            <button className="btn outline" onClick={() => setPending(revertAll())}>
              Revert
            </button>
            <button className="btn primary" title="Review and submit (⌘↩ in the grid)" onClick={() => void submit()}>
              Submit…
            </button>
          </>
        ) : (
          editing &&
          target.reason && (
            <span className="muted small" title="Only results of a single-table SELECT that include the primary key can be edited">
              read-only: {target.reason}
            </span>
          )
        )}
        <label className="foot-filter">
          <Icon name="search" />
          <input placeholder="Filter rows" aria-label="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && (
            <button className="btn icon" aria-label="Clear filter" onClick={() => setFilter('')}>
              <Icon name="close" />
            </button>
          )}
        </label>
        {!isPinned && (
          <button className="btn" title="Keep this result to compare a later run against it" onClick={onPin}>
            <Icon name="pin" /> <span className="lbl">Pin</span>
          </button>
        )}
        {!isPinned && pinned.length > 0 && (
          <button
            className="btn"
            title="Compare with a pinned result"
            onClick={(e) => (pinned.length === 1 ? onCompare(pinned[0].id) : showMenu(e, pinned.map((p) => ({ label: `Compare with ${p.title}`, run: () => onCompare(p.id) }))))}
          >
            <Icon name="diff" /> <span className="lbl">Compare</span>
          </button>
        )}
        <button className={`btn${chartOpen ? ' active' : ''}`} aria-pressed={chartOpen} title="Chart the rows in view" onClick={() => setChartOpen((o) => !o)}>
          <Icon name="chart" /> <span className="lbl">Chart</span>
        </button>
        <button className={`btn${recordOpen ? ' active' : ''}`} aria-pressed={recordOpen} title="Show the selected row as a form" onClick={() => setRecordOpen((o) => !o)}>
          <Icon name="form" /> <span className="lbl">Record</span>
        </button>
        <button className="btn" title="Copy the selected rows, or every row in view" onClick={(e) => showMenu(e, COPY_FORMATS.map((f) => ({ label: f.label, run: () => void copyAs(f.id, f.label) })))}>
          <Icon name="copy" /> <span className="lbl">Copy as</span>
        </button>
        <button className="btn" title="Export Data…" onClick={exportData}>
          <Icon name="export" /> <span className="lbl">Export</span>
        </button>
      </div>
    </>
  )
}

export function ResultsPanel(props: Props) {
  const { engine, outputs, results, plan, active, onActivate, onFetchAll, onPage, onCount, exportSource, onClose } = props
  const outRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active === 'output') outRef.current?.scrollTo(0, outRef.current.scrollHeight)
  }, [outputs, active])

  const current = results.find((r) => r.id === active) ?? props.pinned.find((r) => r.id === active)
  const isPinned = !!props.pinned.find((r) => r.id === active)
  const all = [...props.pinned, ...results]
  const compareTabs = props.compare && all.find((r) => r.id === props.compare!.baseId) && all.find((r) => r.id === props.compare!.otherId) ? props.compare : null
  return (
    <>
      <div className="results-tabs" role="tablist">
        <div className={`rtab${active === 'output' ? ' active' : ''}`} role="tab" onClick={() => onActivate('output')}>
          <Icon name="console" /> Output
        </div>
        {props.pinned.map((r) => (
          <div key={r.id} className={`rtab pinned${active === r.id ? ' active' : ''}`} role="tab" title={r.sql} onClick={() => onActivate(r.id)}>
            <Icon name="pin" /> {r.title}
            <button
              className="btn icon rtab-close"
              aria-label={`Unpin ${r.title}`}
              onClick={(e) => {
                e.stopPropagation()
                props.onUnpin(r.id)
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        {results.map((r) => (
          <div key={r.id} className={`rtab${active === r.id ? ' active' : ''}`} role="tab" title={r.sql} onClick={() => onActivate(r.id)}>
            {r.accent ? <span className="dot" style={{ background: r.accent }} /> : <Icon name="table" />} {r.title}
            <span className="count">
              {r.result.rows.length.toLocaleString()}
              {r.result.hasMore ? '+' : ''}
            </span>
          </div>
        ))}
        {plan && (
          <div className={`rtab${active === 'plan' ? ' active' : ''}`} role="tab" onClick={() => onActivate('plan')}>
            <Icon name="plan" /> Plan
          </div>
        )}
        {compareTabs && (
          <div className={`rtab${active === 'compare' ? ' active' : ''}`} role="tab" onClick={() => onActivate('compare')}>
            <Icon name="diff" /> Compare
          </div>
        )}
        {props.ai.length > 0 && (
          <div className={`rtab${active === 'ai' ? ' active' : ''}`} role="tab" onClick={() => onActivate('ai')}>
            <Icon name="spark" /> AI
            {props.aiRunning ? <span className="spinner" /> : <span className="count">{props.ai.length}</span>}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn icon" title="Hide results (⌘8)" onClick={onClose}>
          <Icon name="chevronDown" />
        </button>
      </div>
      <div className="results-body">
        {active === 'compare' && compareTabs ? (
          <CompareView base={all.find((r) => r.id === compareTabs.baseId)!} other={all.find((r) => r.id === compareTabs.otherId)!} />
        ) : active === 'ai' && props.ai.length > 0 ? (
          <AiPanel entries={props.ai} onInsert={props.onAiInsert} onReplace={props.onAiReplace} onCancel={props.onAiCancel} onClear={props.onAiClear} />
        ) : active === 'plan' && plan ? (
          <PlanView plan={plan} onAnalyze={props.onAnalyzePlan} />
        ) : current ? (
          <ResultView
            tab={current}
            engine={engine}
            source={exportSource(current)}
            onFetchAll={() => onFetchAll(current)}
            onPage={(o, size) => onPage(current, o, size)}
            onCount={() => onCount(current)}
            isPinned={isPinned}
            pinned={props.pinned}
            onPin={() => props.onPin(current)}
            onCompare={(baseId) => props.onCompare(baseId, current.id)}
            editing={props.editing}
          />
        ) : (
          <div className="output mono" ref={outRef}>
            {outputs.length === 0 && <div className="muted">Run a statement with ⌘↩ — results and messages appear here.</div>}
            {outputs.map((o, i) => (
              <div key={i} className="line">
                <span className="time">{new Date(o.at).toLocaleTimeString()}</span>
                <span className={o.kind}>{o.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
