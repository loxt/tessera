import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateDml, inlineParams, literal, quoteIdent } from '@shared/dml'
import { buildWhere, type Condition } from '@shared/filter'
import type { CellValue, DbError, ForeignKeyInfo, ResultSet, TableInfo, TabState } from '@shared/model'
import { registerController } from '../actions'
import { api, errorMessage, newId } from '../api'
import { showMenu } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { DataGrid, type CellPos, type GridHandle } from '../grid/DataGrid'
import { Pager } from '../grid/Pager'
import { addRow, cellState, changeCount, deleteRows, displayValue, editCell, EMPTY, isEmpty, revertAll, revertRows, toChangeSet, type PendingChanges } from '../grid/changes'
import { FilterBuilder } from './FilterBuilder'
import { RecordPanel } from './RecordPanel'
import { beginTask, confirm, finishTask, markConnected, notify, openDdl, openModal, openTable, prompt, reviewChanges, saveViews, setDirty, setPrefs, updateTab, useApp } from '../store'
import { viewsFor, type SavedView } from '@shared/views'

type TableState = Extract<TabState, { kind: 'table' }>

/** A typed SQL filter (FK navigation, SQL mode) stays as the base; visual conditions are ANDed to it. */
const combineWhere = (base: string, built: string) => [base && built ? `(${base})` : base, built].filter(Boolean).join(' AND ')

export function TableTab({ tab, active }: { tab: TableState; active: boolean }) {
  const conn = useApp((s) => s.connections.find((c) => c.id === tab.connectionId))
  const pageSize = useApp((s) => s.prefs.pageSize)
  const engine = conn?.engine ?? 'postgres'
  const [info, setInfo] = useState<TableInfo | null>(null)
  const [data, setData] = useState<ResultSet | null>(null)
  const [error, setError] = useState<DbError | null>(null)
  const [loading, setLoading] = useState(false)
  const [where, setWhere] = useState(tab.where ?? '')
  const [orderBy, setOrderBy] = useState('')
  const [applied, setApplied] = useState({ where: tab.where ?? '', orderBy: '' })
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingChanges>(EMPTY)
  const [loadKey, setLoadKey] = useState(0)
  const [filterMode, setFilterMode] = useState<'visual' | 'sql'>('visual')
  const [conditions, setConditions] = useState<Condition[]>([])
  const [baseWhere, setBaseWhere] = useState(tab.where ?? '')
  const [recordOpen, setRecordOpen] = useState(false)
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const allViews = useApp((s) => s.views)
  const views = useMemo(() => viewsFor(allViews, tab.connectionId, tab.schema, tab.table), [allViews, tab.connectionId, tab.schema, tab.table])
  const [activeView, setActiveView] = useState<string | null>(null)
  /** header filter button: open the visual filter's condition editor on that column */
  const [addColumn, setAddColumn] = useState<{ column: string; at: number } | null>(null)
  const grid = useRef<GridHandle>(null)

  const q = useMemo(() => ({ schema: tab.schema, table: tab.table, where: applied.where, orderBy: applied.orderBy, limit: pageSize, offset }), [tab.schema, tab.table, applied, pageSize, offset])

  const load = useCallback(async () => {
    setLoading(true)
    beginTask(tab.id, `Loading ${tab.table}`)
    setError(null)
    try {
      const ti = await api.tableInfo(tab.connectionId, tab.schema, tab.table)
      setInfo(ti)
      const res = await api.tableData(tab.id, tab.connectionId, q)
      if (res.error) setError(res.error)
      else {
        setData(res.result ?? null)
        setPending(EMPTY)
        setLoadKey((k) => k + 1)
        markConnected(tab.connectionId)
      }
    } catch (err) {
      setError({ message: errorMessage(err) })
    } finally {
      setLoading(false)
      finishTask(tab.id)
    }
  }, [tab.id, tab.connectionId, tab.schema, tab.table, q])

  // like DataGrip: export the loaded page as-is only when it is the whole table, otherwise re-query without the page limit
  const exportData = () =>
    data &&
    openModal({
      kind: 'export',
      result: data,
      table: tab.table,
      engine,
      source: offset > 0 || data.hasMore ? { sessionId: tab.id, connectionId: tab.connectionId, kind: 'table', query: q } : undefined
    })

  // every reload trigger (filters, paging, FK retarget, page-size pref) asks before dropping edits
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => {
    void (async () => {
      if (!isEmpty(pendingRef.current) && !(await confirmDiscardRef.current())) return
      await load()
    })()
  }, [load])
  useEffect(() => {
    setDirty(tab.id, isEmpty(pending) ? undefined : 'changes')
  }, [pending, tab.id])

  // FK navigation can retarget an open tab with a new filter
  useEffect(() => {
    if (tab.where !== undefined && tab.where !== applied.where) {
      setWhere(tab.where)
      setBaseWhere(tab.where)
      setConditions([])
      setApplied((a) => ({ ...a, where: tab.where ?? '' }))
      setOffset(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.where])

  const rows = data?.rows ?? []
  const columns = data?.columns ?? []
  const hidden = useMemo(() => (info?.rowid ? columns.map((c, i) => (c.name === 'rowid' ? i : -1)).filter((i) => i >= 0) : []), [info, columns])
  const editable = !!info && info.kind === 'table' && (info.primaryKey.length > 0 || !!info.rowid) && !conn?.readOnly
  const rowCount = rows.length + pending.inserted.length

  const confirmDiscard = async () =>
    isEmpty(pending) ||
    (await confirm('Discard changes', `${changeCount(pending)} pending change(s) will be lost.`, [
      { label: 'Discard', value: 'discard', danger: true },
      { label: 'Cancel', value: 'cancel', primary: true }
    ])) === 'discard'

  const confirmDiscardRef = useRef(confirmDiscard)
  confirmDiscardRef.current = confirmDiscard

  /** false when the user kept their pending edits instead of reloading */
  const apply = async (patch: Partial<{ where: string; orderBy: string; offset: number; pageSize: number }>): Promise<boolean> => {
    if (!(await confirmDiscard())) return false
    setPending(EMPTY) // already confirmed; the reload effect must not ask again
    if (patch.pageSize !== undefined) {
      // keep the first visible row on the new page
      setOffset(Math.floor(offset / patch.pageSize) * patch.pageSize)
      setPrefs({ pageSize: patch.pageSize })
    } else if ('where' in patch || 'orderBy' in patch) {
      setApplied({ where: patch.where ?? applied.where, orderBy: patch.orderBy ?? applied.orderBy })
      setTotal(null)
      setOffset(0)
    } else if (patch.offset !== undefined) setOffset(Math.max(0, patch.offset))
    return true
  }

  const filterColumns = useMemo(() => (info?.columns ?? []).filter((c) => !(info?.rowid && c.name === 'rowid')), [info])

  const applyVisual = async (next: Condition[], base = baseWhere) => {
    let built: string
    try {
      built = buildWhere(next, filterColumns, engine)
    } catch (err) {
      return notify('error', errorMessage(err))
    }
    const w = combineWhere(base, built)
    if (!(await apply({ where: w }))) return
    setActiveView(null)
    setConditions(next)
    setBaseWhere(base)
    setWhere(w)
    if (!w) updateTab(tab.id, { where: undefined })
  }

  const switchFilterMode = (mode: 'visual' | 'sql') => {
    if (mode === filterMode) return
    // the applied filter never changes here: SQL → visual keeps it as the base chip, visual → SQL as text
    setWhere(applied.where)
    setBaseWhere(mode === 'visual' ? applied.where : '')
    setConditions([])
    setFilterMode(mode)
  }

  // columns a visual condition filters on keep their header filter button lit
  const filteredColumns = useMemo(() => new Set(conditions.map((c) => columns.findIndex((x) => x.name === c.column)).filter((i) => i >= 0)), [conditions, columns])

  const applyView = async (v: SavedView | null) => {
    let built = ''
    try {
      built = v ? buildWhere(v.conditions, filterColumns, engine) : ''
    } catch (err) {
      return notify('error', `View "${v?.name}" no longer fits this table: ${errorMessage(err)}`)
    }
    const w = combineWhere(v?.base ?? '', built)
    if (!(await apply({ where: w, orderBy: v?.orderBy ?? '' }))) return
    setFilterMode('visual')
    setConditions(v?.conditions ?? [])
    setBaseWhere(v?.base ?? '')
    setWhere(w)
    setOrderBy(v?.orderBy ?? '')
    setActiveView(v?.id ?? null)
  }
  const saveView = async () => {
    const name = (await prompt('Save view', 'Name', views.find((v) => v.id === activeView)?.name ?? ''))?.trim()
    if (!name) return
    const existing = views.find((v) => v.name.toLowerCase() === name.toLowerCase())
    const view: SavedView = { id: existing?.id ?? newId(), connectionId: tab.connectionId, schema: tab.schema, table: tab.table, name, conditions, base: baseWhere, orderBy: applied.orderBy }
    saveViews([...allViews.filter((v) => v.id !== view.id), view])
    setActiveView(view.id)
    notify('success', `${existing ? 'Updated' : 'Saved'} view "${name}"`)
  }
  const viewMenu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: 'All rows', shortcut: activeView === null ? '✓' : undefined, run: () => void applyView(null) },
      ...views.map((v) => ({ label: v.name, shortcut: v.id === activeView ? '✓' : undefined, run: () => void applyView(v) })),
      'separator',
      { label: 'Save Current Filter as View…', disabled: !applied.where && !applied.orderBy, run: () => void saveView() },
      ...(activeView
        ? [{ label: `Delete View "${views.find((v) => v.id === activeView)?.name ?? ''}"`, danger: true, run: () => (saveViews(allViews.filter((v) => v.id !== activeView)), setActiveView(null)) }]
        : [])
    ])

  const follow = (fk: ForeignKeyInfo, v: CellValue) => openTable(tab.connectionId, fk.refSchema, fk.refTable, `${quoteIdent(fk.refColumns[0], engine)} = ${literal(v, engine)}`)

  const submit = async () => {
    // ⌘↩ can arrive while a cell editor is open; fold that edit in synchronously
    const open = grid.current?.commitEdit()
    const current = open ? editCell(pending, rows, open.r, open.c, open.value) : pending
    if (!info || !data || isEmpty(current)) return
    let preview: string
    let cs
    try {
      cs = toChangeSet(current, info, data.columns, data.rows)
      preview = generateDml(cs, engine).map((s) => inlineParams(s.sql, s.params, engine) + ';').join('\n')
    } catch (err) {
      return notify('error', errorMessage(err))
    }
    if (!(await reviewChanges(preview, conn?.environment === 'production', engine))) return
    const res = await api.applyChanges(tab.id, tab.connectionId, cs)
    if (res.error) {
      setError(res.error)
      return notify('error', `Changes were rolled back: ${res.error.message}`)
    }
    notify('success', `${res.affected ?? 0} row(s) changed in ${tab.table}`)
    setTotal(null)
    await load()
  }

  const selectedRows = () => grid.current?.selectedRows() ?? []
  const onKeyCommand = (cmd: 'addRow' | 'deleteRows' | 'cloneRow') => {
    if (!editable) return notify('info', conn?.readOnly ? 'The data source is read-only.' : 'This table has no primary key; it cannot be edited.')
    if (cmd === 'addRow') setPending((p) => addRow(p))
    if (cmd === 'deleteRows') setPending((p) => deleteRows(p, selectedRows(), rows.length))
    if (cmd === 'cloneRow') {
      const r = selectedRows()[0]
      if (r === undefined) return
      const init: Record<number, CellValue> = {}
      columns.forEach((c, i) => {
        const v = displayValue(pending, rows, r, i)
        const auto = info!.columns.find((x) => x.name === c.name)?.autoIncrement
        // binary cells hold a truncated preview; copying it would insert corrupted data
        const truncated = v !== null && typeof v === 'object' && v.hex.length < v.size * 2
        if (v !== undefined && !auto && !truncated && c.name !== 'rowid') init[i] = v
      })
      setPending((p) => addRow(p, init))
    }
  }

  const filterBy = (pos: CellPos) => {
    const v = displayValue(pending, rows, pos.r, pos.c) ?? null
    if (filterMode === 'visual' && (v === null || typeof v !== 'object')) {
      const name = columns[pos.c].name
      const cond: Condition = v === null ? { column: name, op: 'isNull' } : { column: name, op: 'eq', value: String(v) }
      return void applyVisual([...conditions, cond])
    }
    const col = quoteIdent(columns[pos.c].name, engine)
    const cond = v === null ? `${col} IS NULL` : `${col} = ${literal(v, engine)}`
    setWhere(cond)
    void apply({ where: cond })
  }

  const fkFor = (colName: string) => info?.foreignKeys.find((fk) => fk.columns.length === 1 && fk.columns[0] === colName)

  const onCellMenu = (e: React.MouseEvent, pos: CellPos | null) => {
    if (!pos) return
    const fk = fkFor(columns[pos.c].name)
    const v = displayValue(pending, rows, pos.r, pos.c)
    showMenu(e, [
      { label: 'Copy', shortcut: '⌘C', run: () => document.execCommand('copy') },
      { label: 'Value Viewer', shortcut: '⇧↩', run: () => grid.current?.toggleViewer() },
      { label: 'Filter by This Value', run: () => filterBy(pos) },
      {
        label: fk ? `Go to ${fk.refTable}` : 'Go to Referenced Row',
        disabled: !fk || v === null || v === undefined,
        run: () => follow(fk!, v ?? null)
      },
      { label: 'Open Record', run: () => setRecordOpen(true) },
      'separator',
      { label: 'Set NULL', shortcut: '⌘⌥N', disabled: !editable, run: () => setPending((p) => grid.current!.selectedCells().reduce((acc, c) => editCell(acc, rows, c.r, c.c, null), p)) },
      { label: 'Add Row', shortcut: '⌘N', disabled: !editable, run: () => onKeyCommand('addRow') },
      { label: 'Clone Row', shortcut: '⌘D', disabled: !editable, run: () => onKeyCommand('cloneRow') },
      { label: 'Delete Row(s)', shortcut: '⌘⌫', disabled: !editable, danger: true, run: () => onKeyCommand('deleteRows') },
      { label: 'Revert Selected', disabled: isEmpty(pending), run: () => setPending((p) => revertRows(p, selectedRows(), rows.length)) },
      'separator',
      { label: 'Export Data…', disabled: !data, run: exportData }
    ])
  }

  const sortCol = (() => {
    const m = /^\s*["`]?([^"`\s]+)["`]?\s+(asc|desc)\s*$/i.exec(applied.orderBy)
    if (!m) return null
    const col = columns.findIndex((c) => c.name === m[1])
    return col >= 0 ? { col, dir: m[2].toLowerCase() as 'asc' | 'desc' } : null
  })()

  const showDdl = async () => {
    try {
      await openDdl(tab.connectionId, `${tab.table}.sql`, api.ddl(tab.connectionId, info?.kind ?? 'table', tab.schema, tab.table))
    } catch (err) {
      notify('error', errorMessage(err))
    }
  }

  const reload = async () => {
    if (await confirmDiscard()) await load()
  }

  const ctlRef = useRef({ submit, reload, revert: () => setPending(revertAll()) })
  ctlRef.current = { submit, reload, revert: () => setPending(revertAll()) }
  useEffect(
    () =>
      registerController(tab.id, {
        submit: () => void ctlRef.current.submit(),
        refresh: () => void ctlRef.current.reload(),
        revert: () => ctlRef.current.revert(),
        focus: () => grid.current?.focus()
      }),
    [tab.id]
  )
  useEffect(() => {
    if (active) setTimeout(() => grid.current?.focus(), 0)
  }, [active])

  const changes = changeCount(pending)
  return (
    <>
      <div className="console-toolbar">
        <button className="btn icon" title="Reload (⌘⌥Y)" onClick={() => void reload()}>
          <Icon name="refresh" />
        </button>
        <div className="sep" />
        <button className="btn icon" title="Add row (⌘N)" disabled={!editable} onClick={() => onKeyCommand('addRow')}>
          <Icon name="plus" />
        </button>
        <button className="btn icon" title="Delete rows (⌘⌫)" disabled={!editable} onClick={() => onKeyCommand('deleteRows')}>
          <Icon name="minus" />
        </button>
        <button className={`btn${changes ? ' active' : ''}`} title="Submit (⌘↩)" disabled={!changes} onClick={() => void submit()}>
          <Icon name="upload" /> Submit{changes ? ` (${changes})` : ''}
        </button>
        <button className="btn icon" title="Revert all changes" disabled={!changes} onClick={() => setPending(revertAll())}>
          <Icon name="revert" />
        </button>
        <div className="sep" />
        <button className="btn icon" title="Value viewer (⇧↩)" onClick={() => grid.current?.toggleViewer()}>
          <Icon name="eye" />
        </button>
        <button className="btn icon" title="Import data from CSV or Excel" disabled={!editable} onClick={() => openModal({ kind: 'import', connectionId: tab.connectionId, schema: tab.schema, table: tab.table, onDone: () => void load() })}>
          <Icon name="upload" />
        </button>
        <button className="btn icon" title="Export data" disabled={!data} onClick={exportData}>
          <Icon name="export" />
        </button>
        <button className="btn" title="Show DDL" onClick={() => void showDdl()}>
          <Icon name="ddl" /> DDL
        </button>
        <button className={`btn${activeView ? ' active' : ''}`} title="Saved filters for this table" onClick={viewMenu}>
          <Icon name="filter" /> {views.find((v) => v.id === activeView)?.name ?? 'Views'}
          {views.length > 0 && !activeView && <span className="count-badge">{views.length}</span>}
        </button>
        <button className={`btn${recordOpen ? ' active' : ''}`} title="Show the selected row as a form" aria-pressed={recordOpen} onClick={() => setRecordOpen((o) => !o)}>
          <Icon name="form" /> Record
        </button>
        <span style={{ flex: 1 }} />
        {!editable && info && <span className="muted small">{conn?.readOnly ? 'read-only data source' : info.kind === 'view' ? 'view · read-only' : 'no primary key · read-only'}</span>}
        {loading && <span className="spinner" />}
      </div>
      <div className={`filter-bar${filterMode === 'visual' ? ' visual' : ''}`}>
        <div className="seg compact" role="radiogroup" aria-label="Filter mode">
          {(['visual', 'sql'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={filterMode === m} className={filterMode === m ? 'on' : ''} onClick={() => switchFilterMode(m)}>
              {m === 'visual' ? 'Filter' : 'SQL'}
            </button>
          ))}
        </div>
        {filterMode === 'visual' ? (
          <FilterBuilder
            columns={filterColumns}
            engine={engine}
            conditions={conditions}
            base={baseWhere}
            appliedWhere={applied.where}
            onChange={(next) => void applyVisual(next)}
            onClearBase={() => void applyVisual(conditions, '')}
            onEditAsSql={() => switchFilterMode('sql')}
            addColumn={addColumn}
          />
        ) : (
          <>
        <label>WHERE</label>
        <input className="input" value={where} placeholder="e.g. status = 'paid'" onChange={(e) => setWhere(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void apply({ where }).then((ok) => ok && setActiveView(null))} />
        <label>ORDER BY</label>
        <input className="input" value={orderBy} placeholder="e.g. created_at DESC" onChange={(e) => setOrderBy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void apply({ orderBy }).then((ok) => ok && setActiveView(null))} />
        {(applied.where || applied.orderBy) && (
          <button
            className="btn icon"
            title="Clear filter"
            onClick={() => {
              setWhere('')
              setOrderBy('')
              setConditions([])
              setBaseWhere('')
              setActiveView(null)
              updateTab(tab.id, { where: undefined })
              void apply({ where: '', orderBy: '' })
            }}
          >
            <Icon name="close" />
          </button>
        )}
          </>
        )}
      </div>
      {error && <div className="banner error mono">{`[${error.code ?? 'error'}] ${error.message}`}</div>}
      {data && (
        <div className="table-body">
        <DataGrid
          handleRef={grid}
          columns={columns}
          rowCount={rowCount}
          hidden={hidden}
          rowNumberOffset={offset}
          resetKey={loadKey}
          getValue={(r, c) => displayValue(pending, rows, r, c)}
          getState={(r, c) => cellState(pending, rows.length, r, c)}
          editable={editable}
          onEdit={(cells, value) => setPending((p) => cells.reduce((acc, cell) => editCell(acc, rows, cell.r, cell.c, value), p))}
          sort={sortCol}
          onSort={(col) => {
            const name = quoteIdent(columns[col].name, engine)
            const next = sortCol?.col !== col ? `${name} ASC` : sortCol.dir === 'asc' ? `${name} DESC` : ''
            setOrderBy(next)
            void apply({ orderBy: next })
          }}
          onCellMenu={onCellMenu}
          onFocusRow={setFocusRow}
          onOpenJson={(p) =>
            openModal({
              kind: 'json',
              title: `${tab.table}.${columns[p.c].name} · row ${offset + p.r + 1}`,
              text: String(displayValue(pending, rows, p.r, p.c) ?? ''),
              onSave: editable && cellState(pending, rows.length, p.r, p.c) !== 'deleted' ? (text) => setPending((cur) => editCell(cur, rows, p.r, p.c, text)) : undefined
            })
          }
          filteredColumns={filteredColumns}
          onFilterColumn={(col) => {
            switchFilterMode('visual')
            setAddColumn({ column: columns[col].name, at: Date.now() })
          }}
          onCommand={(id) => {
            if (id === 'grid.addRow') onKeyCommand('addRow')
            else if (id === 'grid.cloneRow') onKeyCommand('cloneRow')
            else if (id === 'grid.deleteRows') onKeyCommand('deleteRows')
            else if (id === 'grid.submit') void submit()
            else if (id === 'grid.revert') setPending((p) => revertRows(p, selectedRows(), rows.length))
            else if (id === 'grid.export' && data) exportData()
            else return false
            return true
          }}
        />
        {recordOpen && (
          <RecordPanel
            columns={columns}
            hidden={hidden}
            info={info}
            row={focusRow !== null && focusRow < rowCount ? focusRow : null}
            rowLabel={focusRow !== null && focusRow < rows.length ? offset + focusRow + 1 : null}
            getValue={(r, c) => displayValue(pending, rows, r, c)}
            getState={(r, c) => cellState(pending, rows.length, r, c)}
            editable={editable}
            onEdit={(r, c, v) => setPending((p) => editCell(p, rows, r, c, v))}
            onFollow={follow}
            onClose={() => setRecordOpen(false)}
          />
        )}
        </div>
      )}
      <div className="grid-foot">
        <Pager
          offset={offset}
          pageSize={pageSize}
          rows={rows.length}
          hasMore={!!data?.hasMore}
          total={total}
          onPage={(o) => void apply({ offset: o })}
          onPageSize={(n) => void apply({ pageSize: n })}
          onCount={() =>
            void api
              .countRows(tab.id, tab.connectionId, q)
              .then(setTotal)
              .catch((err) => notify('error', errorMessage(err)))
          }
        />
        <span className="grow" />
        {changes > 0 && <span style={{ color: 'var(--accent)' }}>{changes} pending change{changes === 1 ? '' : 's'} · ⌘↩ to submit</span>}
        <span className="muted">{tab.schema}.{tab.table}</span>
      </div>
    </>
  )
}
