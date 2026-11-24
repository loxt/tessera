import { useEffect, useMemo, useState } from 'react'
import { autoMap, buildInserts, type ImportCell } from '@shared/importData'
import type { TableInfo } from '@shared/model'
import { api, errorMessage, newId } from '../api'
import { Icon } from '../components/Icon'
import { closeModal, guardRun, notify, useApp, type Modal as ModalState } from '../store'
import { Modal } from './Dialogs'

type File = Awaited<ReturnType<typeof api.readImportFile>>

const PREVIEW_ROWS = 5
const text = (v: ImportCell | undefined) => (v === null || v === undefined ? '' : String(v))

/** CSV / TSV / Excel into a table: pick the file, match columns, check, then one transaction. */
export function ImportDialog({ m }: { m: Extract<ModalState, { kind: 'import' }> }) {
  const conn = useApp((s) => s.connections.find((c) => c.id === m.connectionId))
  const [info, setInfo] = useState<TableInfo | null>(null)
  const [file, setFile] = useState<File>(null)
  const [sheet, setSheet] = useState(0)
  const [header, setHeader] = useState(true)
  const [emptyAsNull, setEmptyAsNull] = useState(true)
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .tableInfo(m.connectionId, m.schema, m.table)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)))
  }, [m.connectionId, m.schema, m.table])

  const all = file?.sheets[sheet]?.rows ?? []
  const width = Math.max(0, ...all.slice(0, 50).map((r) => r.length))
  const headers = header && all.length ? all[0].map((h, i) => text(h) || `Column ${i + 1}`) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  const rows = header ? all.slice(1) : all
  const columns = useMemo(() => (info?.columns ?? []).filter((c) => c.name !== 'rowid'), [info])

  useEffect(() => {
    if (file && columns.length) setMapping(autoMap(headers, columns))
    // re-match when the file, sheet or header choice changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, sheet, header, columns])

  const built = useMemo(() => buildInserts(rows, mapping, columns, emptyAsNull), [rows, mapping, columns, emptyAsNull])
  const mappedCount = Object.values(mapping).filter((v) => v != null).length

  const choose = async () => {
    setBusy('reading')
    setError('')
    try {
      const f = await api.readImportFile()
      if (f) {
        setFile(f)
        setSheet(0)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    if (!conn || !info || built.problems.length || !rows.length) return
    const summary = `INSERT ${rows.length.toLocaleString()} rows into ${m.schema}.${m.table} from ${file?.fileName}`
    if (conn.environment === 'production' && !(await guardRun({ typed: false, statements: [summary], reasons: [] }, conn.name, true))) {
      // the guard replaced this dialog; reopen it is not worth the state, the user starts again
      return
    }
    setBusy('importing')
    const session = `import-${newId()}`
    try {
      const res = await api.applyChanges(session, m.connectionId, { schema: m.schema, table: m.table, keyColumns: [], updates: [], deletes: [], inserts: built.inserts })
      if (res.error) {
        const msg = `Nothing was imported (the transaction was rolled back): ${res.error.message}`
        // after a production confirmation this dialog is gone, so say it in a notification too
        setError(msg)
        notify('error', msg)
        return
      }
      notify('success', `Imported ${(res.affected ?? rows.length).toLocaleString()} rows into ${m.table}`)
      closeModal()
      m.onDone?.()
    } catch (err) {
      setError(errorMessage(err))
      notify('error', `Import failed: ${errorMessage(err)}`)
    } finally {
      void api.closeSession(session)
      setBusy(null)
    }
  }

  return (
    <Modal
      title={`Import into ${m.table}`}
      wide
      onClose={closeModal}
      footer={
        <>
          <span className="left muted small">One transaction: every row goes in, or none does.</span>
          <button className="btn" onClick={closeModal}>Cancel</button>
          <button className="btn primary" disabled={!file || !rows.length || built.problems.length > 0 || mappedCount === 0 || busy !== null} onClick={() => void run()}>
            {busy === 'importing' ? 'Importing…' : `Import ${rows.length.toLocaleString()} rows`}
          </button>
        </>
      }
    >
      <div className="dialog-body fields">
        <div className="import-file">
          <button className="btn outline" onClick={() => void choose()} disabled={busy !== null}>
            <Icon name="upload" /> {file ? 'Choose another file' : 'Choose CSV, TSV or Excel file'}
          </button>
          {file && (
            <span className="muted small">
              <b>{file.fileName}</b> · {rows.length.toLocaleString()} rows · {headers.length} columns
            </span>
          )}
          {busy === 'reading' && <span className="spinner" />}
        </div>
        {file && file.sheets.length > 1 && (
          <div className="field">
            <label className="lbl" htmlFor="import-sheet">Sheet</label>
            <select id="import-sheet" className="input" value={sheet} onChange={(e) => setSheet(Number(e.target.value))}>
              {file.sheets.map((s, i) => (
                <option key={s.name + i} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {file && (
          <>
            <div className="import-options">
              <label>
                <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> First row has the column names
              </label>
              <label>
                <input type="checkbox" checked={emptyAsNull} onChange={(e) => setEmptyAsNull(e.target.checked)} /> Empty cells become NULL
              </label>
            </div>
            <div className="import-map">
              <table>
                <thead>
                  <tr>
                    <th>Table column</th>
                    <th>From file column</th>
                    <th>First values</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => {
                    const src = mapping[c.name]
                    return (
                      <tr key={c.name}>
                        <td>
                          <span className="mono">{c.name}</span> <span className="muted small mono">{c.type}</span>
                          {!c.nullable && c.default === null && !c.autoIncrement && <span className="req">required</span>}
                        </td>
                        <td>
                          <select className="input" aria-label={`Source for ${c.name}`} value={src ?? ''} onChange={(e) => setMapping((mp) => ({ ...mp, [c.name]: e.target.value === '' ? null : Number(e.target.value) }))}>
                            <option value="">{c.default !== null || c.autoIncrement ? '— database default —' : c.nullable ? '— leave NULL —' : '— choose —'}</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="mono small muted preview-cells">
                          {src != null
                            ? rows
                                .slice(0, PREVIEW_ROWS)
                                .map((r) => text(r[src]) || (emptyAsNull ? 'NULL' : "''"))
                                .join(' · ')
                            : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {built.problems.length > 0 && file && (
          <div className="import-problems" role="alert">
            {built.problems.map((p) => (
              <div key={p}>
                <Icon name="alert" /> {p}
              </div>
            ))}
          </div>
        )}
        {error && <div className="banner error" style={{ borderRadius: 10 }}>{error}</div>}
      </div>
    </Modal>
  )
}
