import { useEffect, useState } from 'react'
import { buildCondition, columnKind, describeCondition, needsValue, opLabel, opsFor, type Condition, type FilterOp } from '@shared/filter'
import type { ColumnMeta, Engine } from '@shared/model'
import { errorMessage } from '../api'
import { Icon } from '../components/Icon'

interface Props {
  columns: ColumnMeta[]
  engine: Engine
  conditions: Condition[]
  /** a typed WHERE (FK navigation, SQL mode) the conditions are added to */
  base: string
  /** the WHERE clause the table is loaded with, shown by "Show SQL" */
  appliedWhere: string
  onChange: (conditions: Condition[]) => void
  onClearBase: () => void
  /** leave the visual builder; the applied WHERE moves to the SQL field */
  onEditAsSql: () => void
  /** a header filter button asked for a condition on this column (`at` makes repeat clicks count) */
  addColumn?: { column: string; at: number } | null
}

const firstOp = (columns: ColumnMeta[], name: string): FilterOp => opsFor(columnKind(columns.find((c) => c.name === name)?.type ?? ''))[0]

interface EditorProps {
  columns: ColumnMeta[]
  engine: Engine
  /** the condition being changed; without it a new one starts on `column` */
  initial?: Condition
  column?: string
  onSubmit: (c: Condition) => void
  onCancel: () => void
}

/** A condition's column, operator and value picked from menus, checked before it is applied. */
function ConditionEditor({ columns, engine, initial, column, onSubmit, onCancel }: EditorProps) {
  const start = column ?? columns[0]?.name ?? ''
  const [cond, setCond] = useState<Condition>(() => initial ?? { column: start, op: firstOp(columns, start) })
  const [error, setError] = useState('')
  const kind = columnKind(columns.find((c) => c.name === cond.column)?.type ?? '')
  const submit = () => {
    try {
      buildCondition(cond, columns, engine)
      onSubmit(needsValue(cond.op) ? cond : { column: cond.column, op: cond.op })
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <div className="cond-editor" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())}>
      <select className="input" aria-label="Column" value={cond.column} autoFocus={!initial || !needsValue(initial.op)} onChange={(e) => (setError(''), setCond({ column: e.target.value, op: firstOp(columns, e.target.value) }))}>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Operator" value={cond.op} onChange={(e) => (setError(''), setCond({ ...cond, op: e.target.value as FilterOp }))}>
        {opsFor(kind).map((op) => (
          <option key={op} value={op}>
            {opLabel(op, kind)}
          </option>
        ))}
      </select>
      {needsValue(cond.op) && (
        <input
          className="input value"
          aria-label="Value"
          aria-invalid={!!error}
          inputMode={kind === 'number' || cond.op === 'lastDays' ? 'decimal' : undefined}
          placeholder={cond.op === 'lastDays' ? 'days, e.g. 30' : kind === 'date' ? 'e.g. 2024-01-31' : 'value'}
          value={cond.value ?? ''}
          onChange={(e) => (setError(''), setCond({ ...cond, value: e.target.value }))}
          autoFocus={!!initial}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      )}
      <button className="btn primary small" onClick={submit}>
        {initial ? 'Save' : 'Add'}
      </button>
      <button className="btn small" onClick={onCancel}>
        Cancel
      </button>
      {error && (
        <span className="cond-error" role="alert">
          <Icon name="alert" /> {error}
        </span>
      )}
    </div>
  )
}

export function FilterBuilder({ columns, engine, conditions, base, appliedWhere, onChange, onClearBase, onEditAsSql, addColumn }: Props) {
  // the editor below the chips: a new condition, or the one at `index` being changed
  const [editing, setEditing] = useState<false | { index?: number; column?: string; at: number }>(false)
  useEffect(() => {
    if (addColumn) setEditing({ column: addColumn.column, at: addColumn.at })
  }, [addColumn])
  const editingIndex = editing ? editing.index : undefined
  const [showSql, setShowSql] = useState(false)
  return (
    <div className="filter-builder">
      <div className="cond-row">
        {base && (
          <span className="cond-chip sql" title={base}>
            <span className="text mono">{base}</span>
            <button className="btn icon" aria-label="Remove the SQL filter" onClick={onClearBase}>
              <Icon name="close" />
            </button>
          </span>
        )}
        {conditions.map((c, i) => (
          <span key={`${c.column}-${c.op}-${i}`} className={`cond-chip${editingIndex === i ? ' editing' : ''}`}>
            {(i > 0 || base) && <span className="and">AND</span>}
            <button className="text" title="Edit this condition" aria-pressed={editingIndex === i} onClick={() => setEditing({ index: i, at: Date.now() })}>
              {describeCondition(c, columns)}
            </button>
            <button
              className="btn icon"
              aria-label={`Remove ${describeCondition(c, columns)}`}
              onClick={() => {
                // indexes shift once a chip is gone, so an open editor would point at the wrong one
                if (editing) setEditing(false)
                onChange(conditions.filter((_, k) => k !== i))
              }}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
        {!editing && (
          <button className="btn outline small" disabled={!columns.length} onClick={() => setEditing({ at: Date.now() })}>
            <Icon name="plus" /> {conditions.length ? 'Condition' : 'Add condition'}
          </button>
        )}
        <span className="grow" />
        {appliedWhere && (
          <button className="btn small" aria-expanded={showSql} onClick={() => setShowSql((v) => !v)}>
            <Icon name="console" /> {showSql ? 'Hide SQL' : 'Show SQL'}
          </button>
        )}
        <button className="btn small" title="Write the WHERE clause yourself" onClick={onEditAsSql}>
          Edit as SQL
        </button>
      </div>
      {editing && (
        <ConditionEditor
          key={editing.at}
          columns={columns}
          engine={engine}
          initial={editing.index === undefined ? undefined : conditions[editing.index]}
          column={editing.column}
          onCancel={() => setEditing(false)}
          onSubmit={(c) => {
            setEditing(false)
            onChange(editing.index === undefined ? [...conditions, c] : conditions.map((old, k) => (k === editing.index ? c : old)))
          }}
        />
      )}
      {showSql && appliedWhere && (
        <pre className="where-preview mono">
          <span className="kw">WHERE</span> {appliedWhere}
        </pre>
      )}
    </div>
  )
}
