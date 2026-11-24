import type { CompletionMetadata } from '@shared/model'

/** A data source's hidden schemas after hiding/unhiding one; undefined when none are left. */
export function setSchemaHidden(hidden: string[] | undefined, schema: string, hide: boolean): string[] | undefined {
  const rest = (hidden ?? []).filter((s) => s !== schema)
  const next = hide ? [...rest, schema].sort((a, b) => a.localeCompare(b)) : rest
  return next.length ? next : undefined
}

/** Completion metadata without the hidden schemas and their tables. */
export function visibleMetadata(md: CompletionMetadata, hidden: string[] | undefined): CompletionMetadata {
  if (!hidden?.length) return md
  const skip = new Set(hidden)
  return { ...md, schemas: md.schemas.filter((s) => !skip.has(s)), tables: md.tables.filter((t) => !skip.has(t.schema)) }
}
