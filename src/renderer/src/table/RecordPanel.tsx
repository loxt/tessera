import { useEffect, useState } from 'react'
import { columnKind } from '@shared/filter'
import type { CellValue, ColumnMeta, ForeignKeyInfo, TableInfo } from '@shared/model'
import { Icon } from '../components/Icon'
import type { CellState } from '../grid/DataGrid'

interface Props {
  columns: ColumnMeta[]
  hidden: number[]
  info: TableInfo | null
  row: number | null
  /** 1-based row number shown in the grid */
  rowLabel: number | null
  getValue: (r: number, c: number) => CellValue | undefined
  getState: (r: number, c: number) => CellState
  editable: boolean
  /** heading when there is no table (query results) */
  title?: string
  /** replaces the default "read-only table" note */
  readOnlyHint?: string
  onEdit: (r: number, c: number, value: CellValue) => void
  onFollow: (fk: ForeignKeyInfo, value: CellValue) => void
  onClose: () => void
}

const text = (v: CellValue | undefined): string => (v === null || v === undefined ? '' : typeof v === 'object' ? `0x${v.hex}` : String(v))

/** One column of the record: label on top, a large field, NULL as an explicit state. */
function RecordField(props: {
  column: ColumnMeta
  value: CellValue | undefined
  state: CellState
  editable: boolean
  isKey: boolean
  /** false for NOT NULL columns: no "Set NULL" offered */
  nullable: boolean
  fk?: ForeignKeyInfo
  onCommit: (value: CellValue) => void
  onFollow: () => void
}) {
  const { column, value, state, editable, isKey, nullable, fk, onCommit, onFollow } = props
  const binary = value !== null && typeof value === 'object'
  const [draft, setDraft] = useState(text(value))
  useEffect(() => {
    setDraft(text(value))
  }, [value])
  const kind = columnKind(column.type)
  const canEdit = editable && !binary && state !== 'deleted'
  const long = draft.length > 60 || draft.includes('\n')
  const commit = () => draft !== text(value) && onCommit(draft)
  const common = {
    id: `rec-${column.name}`,
    className: `input${state ? ` ${state}` : ''}${kind === 'number' ? ' num' : ''}`,
    value: draft,
    readOnly: !canEdit,
    placeholder: value === null ? 'NULL' : value === undefined ? 'default' : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit
  }
  return (
    <div className="field">
      <span className="rec-label">
        <label htmlFor={common.id}>{column.name}</label>
        <span className="rec-type mono">{column.type}</span>
        {isKey && <span className="rec-tag">PK</span>}
        {fk && <span className="rec-tag">FK → {fk.refTable}</span>}
        {canEdit && nullable && !isKey && value !== null && (
          <button className="btn small rec-null" onClick={() => onCommit(null)}>
            Set NULL
          </button>
        )}
      </span>
      <span className="row">
        {long ? (
          <textarea {...common} rows={Math.min(8, draft.split('\n').length + 1)} />
        ) : (
          <input {...common} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
        )}
        {fk && value !== null && value !== undefined && (
          <button className="btn icon" title={`Open the ${fk.refTable} row`} onClick={onFollow}>
            <Icon name="chevronRight" />
          </button>
        )}
      </span>
    </div>
  )
}

/** The focused grid row as a form, editing the same pending changes as the grid. */
export function RecordPanel({ columns, hidden, info, row, rowLabel, getValue, getState, editable, title, readOnlyHint, onEdit, onFollow, onClose }: Props) {
  const fkFor = (name: string) => info?.foreignKeys.find((fk) => fk.columns.length === 1 && fk.columns[0] === name)
  // "id = 7" names the row better than its position on the page
  const pk = info?.primaryKey.length === 1 ? info.primaryKey[0] : null
  const pkIndex = pk ? columns.findIndex((c) => c.name === pk) : -1
  const pkValue = row !== null && pkIndex >= 0 ? getValue(row, pkIndex) : undefined
  return (
    <aside className="record-panel" aria-label="Record">
      <div className="rec-head">
        <span>
          <b>{row === null ? 'Record' : rowLabel === null ? 'New row' : `Row ${rowLabel}`}</b>
          <small>
            {info ? `${info.schema}.${info.name}` : (title ?? '')}
            {pk && pkValue !== undefined && pkValue !== null && typeof pkValue !== 'object' ? ` · ${pk} = ${String(pkValue)}` : ''}
          </small>
        </span>
        <button className="btn icon" aria-label="Close record panel" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {row === null ? (
        <div className="empty">Select a cell in the grid to see the whole row here, one field per column.</div>
      ) : (
        <div className="rec-body">
          {columns.map((col, c) =>
            hidden.includes(c) ? null : (
              <RecordField
                key={col.name}
                column={col}
                value={getValue(row, c)}
                state={getState(row, c)}
                editable={editable}
                isKey={!!info?.primaryKey.includes(col.name)}
                nullable={info?.columns.find((x) => x.name === col.name)?.nullable ?? true}
                fk={fkFor(col.name)}
                onCommit={(v) => onEdit(row, c, v)}
                onFollow={() => {
                  const fk = fkFor(col.name)
                  const v = getValue(row, c)
                  if (fk && v !== undefined) onFollow(fk, v)
                }}
              />
            )
          )}
          {!editable && <p className="hint">{readOnlyHint ?? 'This table is read-only here, so the fields cannot be changed.'}</p>}
        </div>
      )}
    </aside>
  )
}
