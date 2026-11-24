import { useEffect, useRef, useState } from 'react'
import { schemaContext, type AiKind } from '@shared/ai'
import type { CompletionMetadata, Engine } from '@shared/model'
import { api, errorMessage, newId } from '../api'

/** schema text sent with each question; large databases are narrowed to the tables in play */
const SCHEMA_BUDGET = 24_000

export interface AiEntry {
  id: string
  kind: AiKind
  title: string
  text: string
  status: 'running' | 'done' | 'error'
  error?: string
  costUsd?: number
  durationMs?: number
  /** the statement the answer is about (fix replaces it) */
  sql?: string
}

export interface AiAsk {
  question?: string
  sql?: string
  error?: string
  plan?: string
}

/** One console's conversation with the local Claude Code: streamed answers, cancel, clear. */
export function useAi(engine: Engine, md: CompletionMetadata | undefined) {
  const [entries, setEntries] = useState<AiEntry[]>([])
  const ours = useRef(new Set<string>())

  useEffect(() => {
    const off = api.onAiText(({ requestId, text }) => {
      if (ours.current.has(requestId)) setEntries((list) => list.map((e) => (e.id === requestId ? { ...e, text: e.text + text } : e)))
    })
    return () => off()
  }, [])

  const run = async (kind: AiKind, title: string, ask: AiAsk) => {
    const id = newId()
    ours.current.add(id)
    const schema = md ? schemaContext(md, [ask.question, ask.sql].filter(Boolean).join('\n'), engine, SCHEMA_BUDGET) : ''
    setEntries((list) => [...list, { id, kind, title, text: '', status: 'running', sql: ask.sql }])
    try {
      const res = await api.aiRun(id, kind, { engine, schema, ...ask })
      setEntries((list) =>
        list.map((e) =>
          e.id === id ? { ...e, text: res.text || e.text, status: res.ok ? 'done' : 'error', error: res.error, costUsd: res.costUsd, durationMs: res.durationMs } : e
        )
      )
    } catch (err) {
      setEntries((list) => list.map((e) => (e.id === id ? { ...e, status: 'error', error: errorMessage(err) } : e)))
    } finally {
      ours.current.delete(id)
    }
  }

  const cancel = (id: string) => void api.aiCancel(id)
  const clear = () => setEntries((list) => list.filter((e) => e.status === 'running'))
  return { entries, run, cancel, clear, running: entries.some((e) => e.status === 'running') }
}
