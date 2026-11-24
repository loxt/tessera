import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellValue, ExecResult, ExportSource, PlanNode, TabState } from '@shared/model'
import { countSql, pagedSql } from '@shared/export'
import { assessRisk, confirmationFor } from '@shared/safety'
import { connectionAccent } from '@shared/environment'
import { bindParams, findParams, leadingKeyword, splitStatements, statementAt, type Statement } from '@shared/sql'
import { registerController } from '../actions'
import { api, errorMessage, newId } from '../api'
import { EnvBadge } from '../components/EnvBadge'
import { Icon } from '../components/Icon'
import { onRadioKeyDown, radioTabIndex } from '../components/radio'
import { Splitter } from '../components/Splitter'
import { monaco } from '../editor/monaco'
import { formatEditor, SqlEditor } from '../editor/SqlEditor'
import {
  advanceTask,
  askParams,
  beginTask,
  confirm,
  consoleById,
  ensureMetadata,
  finishTask,
  guardRun,
  pickConnections,
  keyLabel,
  markConnected,
  notify,
  openModal,
  refreshConnection,
  setDirty,
  setPrefs,
  tabFlushers,
  updateConsole,
  updateTab,
  useApp
} from '../store'
import { visibleMetadata } from '../schemas'
import { ResultsPanel, type OutputLine, type ResultTab } from './ResultsPanel'
import { planText } from './PlanView'
import { useAi, type AiEntry } from './useAi'

type ConsoleState = Extract<TabState, { kind: 'console' }>

const SCHEMA_CHANGING = new Set(['CREATE', 'ALTER', 'DROP', 'RENAME', 'TRUNCATE', 'COMMENT'])
const REPEATABLE = new Set(['SELECT', 'WITH', 'SHOW', 'VALUES', 'TABLE', 'EXPLAIN', 'PRAGMA', 'DESCRIBE', 'DESC'])
const RUNNING_STATEMENT: monaco.editor.IModelDecorationOptions = { className: 'running-stmt', linesDecorationsClassName: 'running-stmt-gutter' }
const QUEUED_STATEMENT: monaco.editor.IModelDecorationOptions = {}
const firstLine = (text: string) => {
  const line = text.trim().split('\n')[0]
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}
const tip = (id: string, title: string) => (keyLabel(id) ? `${title} (${keyLabel(id)})` : title)

export function ConsoleTab({ tab, active }: { tab: ConsoleState; active: boolean }) {
  const conn = useApp((s) => s.connections.find((c) => c.id === tab.connectionId))
  const connections = useApp((s) => s.connections)
  const prefs = useApp((s) => s.prefs)
  const rawMd = useApp((s) => s.metadata[tab.connectionId])
  const hiddenSchemas = conn?.hiddenSchemas
  const md = useMemo(() => rawMd && visibleMetadata(rawMd, hiddenSchemas), [rawMd, hiddenSchemas])
  const file = useApp((s) => s.consoles.find((c) => c.id === tab.consoleId))
  const schema = file?.schema
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [running, setRunning] = useState(false)
  const [outputs, setOutputs] = useState<OutputLine[]>([])
  const [results, setResults] = useState<ResultTab[]>([])
  const [plan, setPlan] = useState<PlanNode[] | null>(null)
  const [activeResult, setActiveResult] = useState('output')
  const [inTx, setInTx] = useState(false)
  const [showResults, setShowResults] = useState(true)
  const [height, setHeight] = useState(prefs.resultsHeight)
  const paramMemory = useRef<Record<string, string>>({})
  /** statements of the current run; decorations follow edits made while it runs */
  const runMarks = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const engine = conn?.engine ?? 'postgres'
  const ai = useAi(engine, md)
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState('')
  /** the last failed statement, for "Fix with AI" */
  const [lastError, setLastError] = useState<{ sql: string; message: string } | null>(null)
  const [planSql, setPlanSql] = useState('')
  const [pinned, setPinned] = useState<ResultTab[]>([])
  const [compare, setCompare] = useState<{ baseId: string; otherId: string } | null>(null)
  const pin = (r: ResultTab) => {
    const copy = { ...r, id: newId(), title: `${r.title} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` }
    setPinned((p) => [...p, copy])
    setActiveResult(copy.id)
  }

  // completion needs metadata; reload it whenever it goes missing while the console is open
  useEffect(() => {
    if (active && conn && !rawMd) void ensureMetadata(conn.id)
  }, [active, conn, rawMd])
  useEffect(() => {
    setDirty(tab.id, inTx ? 'transaction' : undefined)
  }, [inTx, tab.id])

  const log = (kind: OutputLine['kind'], text: string) => setOutputs((o) => [...o.slice(-500), { at: Date.now(), kind, text }])

  const markError = (st: Statement, res: ExecResult) => {
    if (res.error) setLastError({ sql: st.text, message: res.error.message + (res.error.detail ? `\n${res.error.detail}` : '') })
    const model = editor.current?.getModel()
    if (!model || !res.error) return
    const at = res.error.position ? st.start + res.error.position - 1 : st.start
    const start = model.getPositionAt(at)
    const end = res.error.position ? model.getPositionAt(Math.min(st.end, at + (model.getWordAtPosition(start)?.word.length || 1))) : model.getPositionAt(st.end)
    monaco.editor.setModelMarkers(model, 'tessera', [
      { severity: monaco.MarkerSeverity.Error, message: res.error.message, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }
    ])
  }

  /** Tracks the statements about to run; `showRunning(i)` highlights the one executing. */
  const trackRun = (stmts: Statement[]) => {
    const ed = editor.current
    const model = ed?.getModel()
    if (!ed || !model) return
    runMarks.current ??= ed.createDecorationsCollection()
    runMarks.current.set(
      stmts.map((st) => ({ range: monaco.Range.fromPositions(model.getPositionAt(st.start), model.getPositionAt(st.end)), options: QUEUED_STATEMENT }))
    )
  }
  const showRunning = (i: number) => {
    const marks = runMarks.current
    if (marks) marks.set(marks.getRanges().map((range, j) => ({ range, options: j === i ? RUNNING_STATEMENT : QUEUED_STATEMENT })))
  }
  const endRun = () => {
    runMarks.current?.clear()
    finishTask(tab.id)
    setRunning(false)
  }

  /** Statements to run: the selection (split), the whole script, or the statement at the caret. */
  const targetStatements = (mode: 'caret' | 'script'): Statement[] => {
    const ed = editor.current
    const model = ed?.getModel()
    if (!ed || !model) return []
    const sel = ed.getSelection()
    if (sel && !sel.isEmpty()) {
      const base = model.getOffsetAt(sel.getStartPosition())
      return splitStatements(model.getValueInRange(sel), engine).map((s) => ({ ...s, start: s.start + base, end: s.end + base, endWithDelimiter: s.endWithDelimiter + base }))
    }
    const all = splitStatements(model.getValue(), engine)
    if (mode === 'script') return all
    const st = statementAt(all, model.getOffsetAt(ed.getPosition()!))
    return st ? [st] : []
  }

  /** Prompts for bind variables used by the statements; null when cancelled. */
  const collectParams = async (stmts: Statement[]): Promise<Record<string, CellValue> | null> => {
    const names = [...new Set(stmts.flatMap((s) => findParams(s.text, engine).map((p) => p.name)))]
    if (!names.length) return {}
    const values = await askParams(names, paramMemory.current)
    if (values) for (const [k, v] of Object.entries(values)) if (v !== null) paramMemory.current[k] = v
    return values
  }

  const bind = (st: Statement, values: Record<string, CellValue>) => (findParams(st.text, engine).length ? bindParams(st.text, engine, values) : { sql: st.text, params: undefined })

  const run = async (mode: 'caret' | 'script') => {
    if (!conn || running) return
    const stmts = targetStatements(mode)
    if (!stmts.length) return notify('info', 'Nothing to execute.')
    const values = await collectParams(stmts)
    if (!values) return
    const guard = confirmationFor(stmts.map((s) => s.text), engine, conn.environment, !!conn.readOnly)
    if (guard && !(await guardRun(guard, conn.name, conn.environment === 'production'))) return
    const model = editor.current?.getModel()
    if (model) monaco.editor.setModelMarkers(model, 'tessera', [])
    setRunning(true)
    beginTask(tab.id, 'Executing')
    trackRun(stmts)
    setPlan(null)
    const fresh: ResultTab[] = []
    let schemaChanged = false
    setLastError(null)
    try {
      await api.setAutoCommit(tab.id, conn.id, tab.autoCommit)
      for (const [i, st] of stmts.entries()) {
        advanceTask(tab.id, i + 1, stmts.length)
        showRunning(i)
        const { sql, params } = bind(st, values)
        log('sql', sql.length > 300 ? sql.slice(0, 300) + '…' : sql)
        const res = await api.execute(tab.id, conn.id, sql, { limit: prefs.pageSize, params, schema })
        setInTx(res.inTransaction)
        if (res.error) {
          log('error', `[${res.error.code ?? 'error'}] ${res.error.message}${res.error.detail ? `\n${res.error.detail}` : ''}${res.error.hint ? `\nHint: ${res.error.hint}` : ''}`)
          markError(st, res)
          setActiveResult('output')
          break
        }
        markConnected(conn.id)
        const ms = Math.round(res.durationMs)
        if (res.result) {
          const n = res.result.rows.length
          log('ok', `${n}${res.result.hasMore ? '+' : ''} row${n === 1 ? '' : 's'} retrieved in ${ms} ms`)
          fresh.push({ id: newId(), title: `Result ${fresh.length + 1}`, sql, params, result: res.result, durationMs: res.durationMs })
        } else log('ok', `${res.command ? res.command + ': ' : ''}${res.affected ?? 0} row${res.affected === 1 ? '' : 's'} affected in ${ms} ms`)
        if (SCHEMA_CHANGING.has(leadingKeyword(sql, engine))) schemaChanged = true
      }
    } catch (err) {
      log('error', errorMessage(err))
    } finally {
      endRun()
    }
    if (fresh.length) {
      setResults(fresh)
      setActiveResult(fresh[fresh.length - 1].id)
    } else if (stmts.length) setActiveResult((a) => (a === 'plan' ? 'output' : a))
    setShowResults(true)
    if (schemaChanged) void refreshConnection(conn.id)
  }

  const isRepeatable = (sql: string) => REPEATABLE.has(leadingKeyword(sql, engine)) && !/\b(insert|update|delete|merge)\b/i.test(sql)

  // export of a truncated result re-runs its statement without the fetch limit, like DataGrip
  /** where a result re-runs (paging, count, export): its own data source for multi-source runs */
  const target = (r: ResultTab) => (r.connectionId ? { session: r.sessionId ?? tab.id, conn: r.connectionId, schema: undefined } : { session: tab.id, conn: conn?.id ?? '', schema })
  const exportSource = (r: ResultTab): ExportSource | undefined =>
    conn && isRepeatable(r.sql) ? { sessionId: target(r).session, connectionId: target(r).conn, kind: 'sql', sql: r.sql, params: r.params, schema: target(r).schema } : undefined

  const fetchAll = async (r: ResultTab) => {
    if (!conn) return
    if (!isRepeatable(r.sql)) {
      return notify('info', 'Fetch all is only available for read-only queries (it re-runs the statement).')
    }
    setRunning(true)
    beginTask(tab.id, 'Fetching all rows')
    try {
      const t = target(r)
      const res = await api.execute(t.session, t.conn, r.sql, { params: r.params, schema: t.schema })
      if (res.error) return log('error', res.error.message)
      setResults((rs) => rs.map((x) => (x.id === r.id ? { ...x, result: res.result!, durationMs: res.durationMs, offset: 0 } : x)))
      log('ok', `${res.result?.rows.length ?? 0} rows retrieved in ${Math.round(res.durationMs)} ms`)
    } catch (err) {
      log('error', errorMessage(err))
    } finally {
      endRun()
    }
  }

  /** another page of a result: the statement re-run as a subquery with LIMIT/OFFSET */
  const fetchPage = async (r: ResultTab, offset: number, size = prefs.pageSize) => {
    if (!conn) return
    if (size !== prefs.pageSize) setPrefs({ pageSize: size })
    const sql = pagedSql(r.sql, engine, offset, size, r.result.columns.map((c) => c.name))
    if (!isRepeatable(r.sql) || !sql) return notify('info', 'Paging is only available for read-only SELECT queries (it re-runs the statement).')
    setRunning(true)
    beginTask(tab.id, 'Loading page')
    try {
      const t = target(r)
      const res = await api.execute(t.session, t.conn, sql, { limit: size, params: r.params, schema: t.schema })
      if (res.error) return log('error', `[${res.error.code ?? 'error'}] ${res.error.message}`)
      setResults((rs) => rs.map((x) => (x.id === r.id ? { ...x, result: res.result!, durationMs: res.durationMs, offset } : x)))
    } catch (err) {
      log('error', errorMessage(err))
    } finally {
      endRun()
    }
  }

  const countResult = async (r: ResultTab) => {
    if (!conn) return
    const sql = countSql(r.sql, engine)
    if (!isRepeatable(r.sql) || !sql) return notify('info', 'Count is only available for read-only SELECT queries.')
    try {
      const t = target(r)
      const res = await api.execute(t.session, t.conn, sql, { params: r.params, schema: t.schema })
      if (res.error) return notify('error', res.error.message)
      const total = Number(res.result?.rows[0]?.[0])
      setResults((rs) => rs.map((x) => (x.id === r.id ? { ...x, total: Number.isFinite(total) ? total : null } : x)))
    } catch (err) {
      notify('error', errorMessage(err))
    }
  }

  const explain = async (analyze: boolean) => {
    if (!conn) return
    const [st] = targetStatements('caret')
    if (!st) return notify('info', 'Place the caret inside a statement.')
    const values = await collectParams([st])
    if (!values) return
    const { sql, params } = bind(st, values)
    if (params?.length) return notify('info', 'Explain does not support bind parameters; inline the values first.')
    setRunning(true)
    beginTask(tab.id, analyze ? 'Explain analyse' : 'Explain plan')
    trackRun([st])
    showRunning(0)
    try {
      setPlan(await api.explain(tab.id, conn.id, sql, analyze, schema))
      setPlanSql(sql)
      setActiveResult('plan')
      setShowResults(true)
      log('ok', `${analyze ? 'Explain analyse' : 'Explain plan'} finished`)
    } catch (err) {
      log('error', errorMessage(err))
      setActiveResult('output')
    } finally {
      endRun()
    }
  }

  const endTx = async (verb: 'commit' | 'rollback') => {
    const res = verb === 'commit' ? await api.commit(tab.id) : await api.rollback(tab.id)
    setInTx(res.inTransaction)
    if (res.error) log('error', res.error.message)
    else log('ok', verb === 'commit' ? 'Transaction committed' : 'Transaction rolled back')
  }

  const setAutoCommit = async (on: boolean) => {
    if (!conn || on === tab.autoCommit) return
    if (on && inTx) {
      const choice = await confirm('Switch to auto-commit', 'There is an open transaction.', [
        { label: 'Commit', value: 'commit', primary: true },
        { label: 'Rollback', value: 'rollback', danger: true },
        { label: 'Cancel', value: 'cancel' }
      ])
      if (!choice || choice === 'cancel') return
      await endTx(choice as 'commit' | 'rollback')
    }
    updateTab(tab.id, { autoCommit: on })
    await api.setAutoCommit(tab.id, conn.id, on)
  }

  const switchConnection = async (id: string) => {
    if (inTx) {
      const ok = await confirm('Change data source', 'The open transaction will be rolled back.', [
        { label: 'Roll back and switch', value: 'ok', danger: true },
        { label: 'Cancel', value: 'cancel', primary: true }
      ])
      if (ok !== 'ok') return
      await api.rollback(tab.id)
    }
    await api.closeSession(tab.id) // release the old connection (and its locks) right away
    setInTx(false)
    updateConsole(tab.consoleId, { connectionId: id, schema: undefined })
  }

  /** sessions opened by multi-source runs, closed with the console */
  const extraSessions = useRef(new Set<string>())
  useEffect(() => () => extraSessions.current.forEach((id) => void api.closeSession(id)), [])

  /** The statement at the caret on several data sources at once, one result tab each (read-only statements only). */
  const runOnMany = async () => {
    if (!conn || running) return
    const [st] = targetStatements('caret')
    if (!st) return notify('info', 'Place the caret inside a statement.')
    if (assessRisk(st.text, engine).level !== 'read') return notify('info', 'Only read-only statements run on several data sources at once.')
    const ids = await pickConnections(connections.filter((c) => c.engine === engine).map((c) => c.id))
    if (!ids?.length) return
    const values = await collectParams([st])
    if (!values) return
    const { sql, params } = bind(st, values)
    setRunning(true)
    beginTask(tab.id, `Running on ${ids.length} data sources`)
    try {
      const fresh = await Promise.all(
        ids.map(async (id) => {
          const c = connections.find((x) => x.id === id)!
          const session = `${tab.id}@${id}`
          extraSessions.current.add(session)
          const res = await api.execute(session, id, sql, { limit: prefs.pageSize, params, schema: id === conn.id ? schema : undefined })
          if (res.error) {
            log('error', `[${c.name}] ${res.error.message}`)
            return null
          }
          log('ok', `[${c.name}] ${res.result ? `${res.result.rows.length}${res.result.hasMore ? '+' : ''} rows` : `${res.affected ?? 0} rows affected`} in ${Math.round(res.durationMs)} ms`)
          return res.result
            ? ({ id: newId(), title: c.name, sql, params, result: res.result, durationMs: res.durationMs, connectionId: id, sessionId: session, accent: connectionAccent(c) ?? 'var(--faint)' } satisfies ResultTab)
            : null
        })
      )
      const ok = fresh.filter((r): r is NonNullable<typeof r> => !!r)
      if (ok.length) {
        setResults(ok)
        setActiveResult(ok[0].id)
      } else setActiveResult('output')
      setShowResults(true)
    } catch (err) {
      log('error', errorMessage(err))
    } finally {
      endRun()
    }
  }

  /** AI answers open in the results panel's AI tab */
  const askAi = (...args: Parameters<typeof ai.run>) => {
    setShowResults(true)
    setActiveResult('ai')
    void ai.run(...args)
  }
  const submitQuestion = () => {
    const q = question.trim()
    if (!q) return
    askAi('ask', q, { question: q })
    setQuestion('')
  }
  const explainAi = () => {
    const [st] = targetStatements('caret')
    if (!st) return notify('info', 'Place the caret inside a statement to explain it.')
    askAi('explain', firstLine(st.text), { sql: st.text })
  }
  const fixAi = () => {
    if (!lastError) return notify('info', 'Run a statement first; Fix with AI works on the last error.')
    askAi('fix', firstLine(lastError.message), { sql: lastError.sql, error: lastError.message })
  }
  const insertSql = (sql: string) => {
    const ed = editor.current
    if (!ed) return
    const sel = ed.getSelection()
    const model = ed.getModel()!
    // on its own line(s) unless replacing a selection
    const atLineStart = sel?.isEmpty() && sel.startColumn === 1
    const text = sel && !sel.isEmpty() ? sql : `${atLineStart ? '' : '\n'}${sql}\n`
    ed.executeEdits('ai', [{ range: sel ?? model.getFullModelRange(), text, forceMoveMarkers: true }])
    ed.focus()
  }
  const replaceStatement = (entry: AiEntry, sql: string) => {
    const ed = editor.current
    const model = ed?.getModel()
    if (!ed || !model || !entry.sql) return insertSql(sql)
    const at = model.getValue().indexOf(entry.sql)
    if (at < 0) return insertSql(sql)
    const range = monaco.Range.fromPositions(model.getPositionAt(at), model.getPositionAt(at + entry.sql.length))
    // keep the statement's own terminator: the failed text may or may not include its ';'
    const text = sql.replace(/;\s*$/, entry.sql.trimEnd().endsWith(';') ? ';' : '')
    ed.executeEdits('ai', [{ range, text, forceMoveMarkers: true }])
    ed.setSelection(monaco.Range.fromPositions(model.getPositionAt(at), model.getPositionAt(at + text.length)))
    ed.focus()
  }

  const ctl = {
    execute: () => void run('caret'),
    executeScript: () => void run('script'),
    cancel: () => void api.cancel(tab.id).then(() => log('info', 'Cancellation requested')),
    explain: (analyze: boolean) => void explain(analyze),
    commit: () => void endTx('commit'),
    rollback: () => void endTx('rollback'),
    toggleAutoCommit: () => void setAutoCommit(!tab.autoCommit),
    history: () =>
      conn &&
      openModal({
        kind: 'history',
        connectionId: conn.id,
        onPick: (sql, runIt) => {
          const ed = editor.current
          if (!ed) return
          ed.executeEdits('history', [{ range: ed.getSelection() ?? ed.getModel()!.getFullModelRange(), text: sql }])
          ed.focus()
          // the caret now sits at the end of the inserted statement, so "caret" mode picks it
          if (runIt) void run('caret')
        }
      }),
    format: () => editor.current && formatEditor(editor.current, engine),
    saveFile: async () => {
      try {
        const path = await api.saveFile(`${tab.title.replace(/\W+/g, '_')}.sql`, editor.current?.getValue() ?? file?.text ?? "")
        if (path) notify('success', `Saved ${path}`)
      } catch (err) {
        notify('error', errorMessage(err))
      }
    },
    toggleResults: () => setShowResults((v) => !v),
    focus: () => editor.current?.focus(),
    askAi: () => setAskOpen(true),
    runOnMany: () => void runOnMany(),
    explainAi,
    fixAi
  }
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  useEffect(() => {
    const flush = () => {
      clearTimeout(textTimer.current)
      const text = editor.current?.getValue()
      if (text !== undefined && text !== consoleById(tab.consoleId)?.text) updateConsole(tab.consoleId, { text })
    }
    tabFlushers.set(tab.id, flush)
    const unregister = registerController(tab.id, {
        execute: () => ctlRef.current.execute(),
        executeScript: () => ctlRef.current.executeScript(),
        cancel: () => ctlRef.current.cancel(),
        explain: (a) => ctlRef.current.explain(a),
        commit: () => ctlRef.current.commit(),
        rollback: () => ctlRef.current.rollback(),
        toggleAutoCommit: () => ctlRef.current.toggleAutoCommit(),
        history: () => void ctlRef.current.history(),
        format: () => void ctlRef.current.format(),
        saveFile: () => void ctlRef.current.saveFile(),
        toggleResults: () => ctlRef.current.toggleResults(),
        askAi: () => ctlRef.current.askAi(),
        runOnMany: () => ctlRef.current.runOnMany(),
        explainAi: () => ctlRef.current.explainAi(),
        fixAi: () => ctlRef.current.fixAi(),
        focus: () => ctlRef.current.focus(),
        flush
      })
    return () => {
      unregister()
      tabFlushers.delete(tab.id)
    }
  }, [tab.id, tab.consoleId])
  useEffect(() => {
    if (active) setTimeout(() => editor.current?.focus(), 0)
  }, [active])

  const textTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // a console already pointed at a schema keeps it in the picker even after it was hidden
  const schemas = schema && md && !md.schemas.includes(schema) ? [...md.schemas, schema] : (md?.schemas ?? [])

  return (
    <>
      <div className="console-toolbar">
        <button className="btn primary" title={tip('query.execute', 'Execute')} disabled={running || !conn} onClick={ctl.execute}>
          <Icon name="play" /> Run {keyLabel('query.execute') && <span className="kbd-hint">{keyLabel('query.execute')}</span>}
        </button>
        <button className="btn icon" title={tip('query.executeScript', 'Execute script')} disabled={running || !conn} onClick={ctl.executeScript}>
          <Icon name="playAll" />
        </button>
        <button className="btn icon" title={tip('query.cancel', 'Cancel')} disabled={!running} onClick={ctl.cancel}>
          <Icon name="stop" />
        </button>
        <button className="btn icon" title="Explain plan" disabled={running || !conn} onClick={() => ctl.explain(false)}>
          <Icon name="plan" />
        </button>
        <div className="sep" />
        <span className="tx-label">Transaction</span>
        <div className={`capsule${tab.autoCommit ? '' : ' right'}`} role="radiogroup" aria-label="Transaction mode" title="Transaction mode" onKeyDown={onRadioKeyDown}>
          <i className="knob" />
          <button role="radio" aria-checked={tab.autoCommit} tabIndex={radioTabIndex(tab.autoCommit, 0, true)} onClick={() => void setAutoCommit(true)}>
            Auto
          </button>
          <button role="radio" aria-checked={!tab.autoCommit} tabIndex={radioTabIndex(!tab.autoCommit, 1, true)} onClick={() => void setAutoCommit(false)}>
            Manual
          </button>
        </div>
        <button className="btn icon" title={tip('tx.commit', 'Commit')} disabled={!inTx} onClick={ctl.commit}>
          <Icon name="commit" />
        </button>
        <button className="btn icon" title="Rollback" disabled={!inTx} onClick={ctl.rollback}>
          <Icon name="rollback" />
        </button>
        {inTx && <span className="tx-badge">transaction open</span>}
        <div className="sep" />
        <button className="btn icon" title={tip('query.history', 'Query history')} disabled={!conn} onClick={() => void ctl.history()}>
          <Icon name="history" />
        </button>
        <button className="btn icon" title={tip('editor.format', 'Reformat')} onClick={() => void ctl.format()}>
          <Icon name="edit" />
        </button>
        <button className="btn icon" title={tip('query.runOnMany', 'Run the statement on several data sources')} disabled={running || !conn || connections.length < 2} onClick={() => void runOnMany()}>
          <Icon name="database" />
        </button>
        <div className="sep" />
        <button className={`btn soft${askOpen ? ' active' : ''}`} title={tip('ai.ask', 'Describe a query and let Claude write it')} disabled={!conn} onClick={() => setAskOpen((o) => !o)}>
          <Icon name="spark" /> Ask AI
        </button>
        <button className="btn" title={tip('ai.explain', 'Explain the statement at the caret')} disabled={!conn} onClick={explainAi}>
          Explain
        </button>
        {lastError && (
          <button className="btn danger" title={tip('ai.fix', 'Ask Claude to fix the last error')} onClick={fixAi}>
            <Icon name="spark" /> Fix error
          </button>
        )}
        <span style={{ flex: 1 }} />
        {conn?.environment && <EnvBadge env={conn.environment} />}
        {schemas.length > 1 && (
          <select className="input" title="Default schema for this console" value={schema ?? md?.defaultSchema ?? ''} onChange={(e) => updateConsole(tab.consoleId, { schema: e.target.value })}>
            {schemas.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <select className="input" title="Data source" value={tab.connectionId} onChange={(e) => void switchConnection(e.target.value)}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {running && <div className="query-progress" role="progressbar" aria-label="Query running" />}
      </div>
      {askOpen && (
        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault()
            submitQuestion()
          }}
        >
          <Icon name="spark" />
          <input
            autoFocus
            aria-label="Describe the query"
            placeholder="Describe the query, e.g. customers with more than 3 orders and none paid"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAskOpen(false)
                editor.current?.focus()
              }
            }}
          />
          <button type="submit" className="btn primary small" disabled={!question.trim()}>
            Generate SQL
          </button>
          <button type="button" className="btn icon" aria-label="Close" onClick={() => setAskOpen(false)}>
            <Icon name="close" />
          </button>
        </form>
      )}
      <SqlEditor
        connectionId={tab.connectionId}
        value={file?.text ?? ""}
        engine={engine}
        metadata={md}
        onReady={(ed) => (editor.current = ed)}
        onChange={(text) => {
          clearTimeout(textTimer.current)
          textTimer.current = setTimeout(() => updateConsole(tab.consoleId, { text }), 300)
        }}
      />
      {showResults && (
        <>
          <Splitter direction="h" size={height} min={80} max={window.innerHeight - 200} sign={-1} onResize={setHeight} onCommit={(h) => setPrefs({ resultsHeight: h })} />
          <div className="results" style={{ height }}>
            <ResultsPanel
              engine={engine}
              outputs={outputs}
              results={results}
              plan={plan}
              active={activeResult}
              onActivate={setActiveResult}
              onFetchAll={(r) => void fetchAll(r)}
              onPage={(r, offset, size) => void fetchPage(r, offset, size)}
              onCount={(r) => void countResult(r)}
              exportSource={exportSource}
              onClose={() => setShowResults(false)}
              ai={ai.entries}
              aiRunning={ai.running}
              onAiInsert={insertSql}
              onAiReplace={replaceStatement}
              onAiCancel={ai.cancel}
              onAiClear={ai.clear}
              pinned={pinned}
              onPin={pin}
              onUnpin={(id) => {
                setPinned((p) => p.filter((x) => x.id !== id))
                setActiveResult((a) => (a === id ? 'output' : a))
              }}
              compare={compare}
              onCompare={(baseId, otherId) => {
                setCompare({ baseId, otherId })
                setActiveResult('compare')
              }}
              editing={
                conn && {
                  sessionId: tab.id,
                  connectionId: conn.id,
                  defaultSchema: schema ?? md?.defaultSchema,
                  readOnly: !!conn.readOnly,
                  production: conn.environment === 'production',
                  onApplied: (res) => {
                    setInTx(res.inTransaction)
                    if (res.error) log('error', `Changes were rolled back: ${res.error.message}`)
                    else log('ok', `${res.affected ?? 0} row${res.affected === 1 ? '' : 's'} changed${res.inTransaction ? ' (transaction open: commit to keep)' : ''}`)
                  }
                }
              }
              onAnalyzePlan={plan ? () => askAi('plan', firstLine(planSql), { sql: planSql, plan: planText(plan) }) : undefined}
            />
          </div>
        </>
      )}
    </>
  )
}
