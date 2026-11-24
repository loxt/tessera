import { useEffect, useState } from 'react'
import { cancelTab } from '../actions'
import { Icon } from '../components/Icon'
import { activate, useApp } from '../store'
import { formatElapsed, orderTasks, taskText } from '../tasks'

const TICK_MS = 100

/** Re-renders every TICK_MS while `on`, for elapsed-time readouts. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** Status bar progress of the queries running in any tab: the active tab's first, the others counted. */
export function TaskIndicator() {
  const tasks = useApp((s) => s.tasks)
  const activeTabId = useApp((s) => s.activeTabId)
  const tabs = useApp((s) => s.tabs)
  const list = orderTasks(tasks, activeTabId)
  const now = useNow(list.length > 0)
  if (!list.length) return null
  const [task, ...others] = list
  const title = tabs.find((t) => t.id === task.tabId)?.title
  const summary = `${title ? `${title} · ` : ''}${taskText(task)}`
  return (
    <span className="item task-indicator" role="status">
      <span className="task-bar" aria-hidden="true" />
      <button className="task-label" title={`Go to ${title ?? 'tab'}`} onClick={() => activate(task.tabId)}>
        {summary} · <span className="task-elapsed">{formatElapsed(now - task.startedAt)}</span>
      </button>
      {others.length > 0 && <span title={`${others.length} more running`}>+{others.length}</span>}
      <button className="btn icon task-cancel" title="Cancel" aria-label={`Cancel ${summary}`} onClick={() => cancelTab(task.tabId)}>
        <Icon name="stop" />
      </button>
    </span>
  )
}
