import type { Engine, TableInfo } from '@shared/model'
import { quoteIfNeeded } from './editor/completion'

export type TemplateKind = 'select' | 'insert' | 'update' | 'delete'

const param = (col: string) => ':' + col.replace(/\W/g, '_')

/** DataGrip-style "SQL Generator" templates with named parameters. */
export function sqlTemplate(kind: TemplateKind, info: TableInfo, engine: Engine): string {
  const q = (n: string) => quoteIfNeeded(n, engine)
  const target = `${q(info.schema)}.${q(info.name)}`
  const cols = info.columns.map((c) => c.name)
  const keys = info.primaryKey.length ? info.primaryKey : cols.slice(0, 1)
  const where = keys.map((k) => `${q(k)} = ${param(k)}`).join(' AND ')
  switch (kind) {
    case 'select':
      return `SELECT ${cols.map(q).join(', ')}\nFROM ${target}\nLIMIT 100;`
    case 'insert': {
      const ins = info.columns.filter((c) => !c.autoIncrement).map((c) => c.name)
      return `INSERT INTO ${target} (${ins.map(q).join(', ')})\nVALUES (${ins.map(param).join(', ')});`
    }
    case 'update': {
      const set = cols.filter((c) => !keys.includes(c))
      return `UPDATE ${target}\nSET ${set.map((c) => `${q(c)} = ${param(c)}`).join(',\n    ')}\nWHERE ${where};`
    }
    case 'delete':
      return `DELETE FROM ${target}\nWHERE ${where};`
  }
}

export const allTemplates = (info: TableInfo, engine: Engine) =>
  (['select', 'insert', 'update', 'delete'] as const).map((k) => sqlTemplate(k, info, engine)).join('\n\n')
