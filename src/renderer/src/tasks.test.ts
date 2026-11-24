import { describe, expect, test } from 'vitest'
import { endTask, formatElapsed, orderTasks, startTask, stepTask, taskText, type QueryTask } from './tasks'

const task = (tabId: string, startedAt = 0): QueryTask => ({ tabId, label: 'Executing', startedAt })

describe('query tasks', () => {
  test('start adds the task without touching the original record', () => {
    const before = {}
    const after = startTask(before, task('a'))
    expect(after).toEqual({ a: task('a') })
    expect(before).toEqual({})
  })

  test('a tab runs one query at a time: starting again replaces its task', () => {
    const tasks = startTask(startTask({}, task('a', 1)), task('a', 2))
    expect(Object.keys(tasks)).toEqual(['a'])
    expect(tasks.a.startedAt).toBe(2)
  })

  test('step records statement progress only for a running task', () => {
    const tasks = startTask({}, task('a'))
    expect(stepTask(tasks, 'a', 2, 5).a.step).toEqual({ n: 2, total: 5 })
    expect(tasks.a.step).toBeUndefined()
    expect(stepTask(tasks, 'gone', 1, 2)).toBe(tasks)
  })

  test('end removes the task and keeps the others', () => {
    const tasks = startTask(startTask({}, task('a')), task('b'))
    expect(endTask(tasks, 'a')).toEqual({ b: task('b') })
    expect(endTask(tasks, 'gone')).toBe(tasks)
  })

  test('the active tab comes first, then the most recent', () => {
    const tasks = startTask(startTask(startTask({}, task('a', 1)), task('b', 3)), task('c', 2))
    expect(orderTasks(tasks, 'a').map((t) => t.tabId)).toEqual(['a', 'b', 'c'])
    expect(orderTasks(tasks, undefined).map((t) => t.tabId)).toEqual(['b', 'c', 'a'])
  })

  test('text shows the statement counter only for scripts', () => {
    expect(taskText(task('a'))).toBe('Executing')
    expect(taskText({ ...task('a'), step: { n: 1, total: 1 } })).toBe('Executing')
    expect(taskText({ ...task('a'), step: { n: 2, total: 5 } })).toBe('Executing 2/5')
  })

  test('elapsed time is seconds with a decimal (truncated, like a stopwatch), then minutes', () => {
    expect(formatElapsed(0)).toBe('0.0 s')
    expect(formatElapsed(3_450)).toBe('3.4 s')
    expect(formatElapsed(59_940)).toBe('59.9 s')
    expect(formatElapsed(60_000)).toBe('1:00')
    expect(formatElapsed(754_000)).toBe('12:34')
    expect(formatElapsed(-5)).toBe('0.0 s')
  })
})
