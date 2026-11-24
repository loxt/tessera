/** A query running in a tab's session, shown in the status bar until it ends. */
export interface QueryTask {
  tabId: string
  /** what is running, e.g. "Executing" or "Loading customers" */
  label: string
  startedAt: number
  /** statement being executed out of the script's total */
  step?: { n: number; total: number }
}

/** keyed by tab: each tab has one session, which runs one query at a time */
export type Tasks = Record<string, QueryTask>

export const startTask = (tasks: Tasks, task: QueryTask): Tasks => ({ ...tasks, [task.tabId]: task })

export function stepTask(tasks: Tasks, tabId: string, n: number, total: number): Tasks {
  const task = tasks[tabId]
  return task ? { ...tasks, [tabId]: { ...task, step: { n, total } } } : tasks
}

export function endTask(tasks: Tasks, tabId: string): Tasks {
  if (!(tabId in tasks)) return tasks
  const { [tabId]: _ended, ...rest } = tasks
  return rest
}

/** The active tab's task first, then the most recently started. */
export const orderTasks = (tasks: Tasks, activeTabId: string | undefined): QueryTask[] =>
  Object.values(tasks).sort((a, b) => Number(b.tabId === activeTabId) - Number(a.tabId === activeTabId) || b.startedAt - a.startedAt)

export const taskText = (task: QueryTask): string => (task.step && task.step.total > 1 ? `${task.label} ${task.step.n}/${task.step.total}` : task.label)

export function formatElapsed(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < 60_000) return `${(Math.floor(safe / 100) / 10).toFixed(1)} s`
  const s = Math.floor(safe / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
