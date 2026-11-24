import { describe, expect, test } from 'vitest'
import { activeOf, addTab, activate, focusPane, moveToOtherPane, normalizeLayout, removeTab, single, unsplit } from './layout'

describe('pane layout', () => {
  test('normalize puts unknown tabs in the first pane and drops missing ones', () => {
    const l = normalizeLayout({ panes: [{ tabIds: ['a', 'gone'] }, { tabIds: ['b'], activeId: 'b' }], focused: 1, orientation: 'row', ratio: 0.5 }, ['a', 'b', 'c'])
    expect(l.panes).toEqual([{ tabIds: ['a', 'c'], activeId: 'a' }, { tabIds: ['b'], activeId: 'b' }])
    expect(activeOf(l)).toBe('b')
    expect(normalizeLayout(undefined, ['x']).panes).toEqual([{ tabIds: ['x'], activeId: 'x' }])
  })

  test('new tabs open in the focused pane', () => {
    let l = moveToOtherPane(addTab(addTab(single(), 'a'), 'b'), 'b', 'row')
    l = addTab(l, 'c')
    expect(l.panes[1].tabIds).toEqual(['b', 'c'])
    expect(activeOf(l)).toBe('c')
  })

  test('split moves the tab to a new pane; the last tab of a pane cannot leave it alone', () => {
    const two = addTab(addTab(single(), 'a'), 'b')
    const split = moveToOtherPane(two, 'b', 'column')
    expect(split.panes.map((p) => p.tabIds)).toEqual([['a'], ['b']])
    expect(split.orientation).toBe('column')
    expect(split.focused).toBe(1)
    expect(moveToOtherPane(addTab(single(), 'a'), 'a', 'row')).toEqual(addTab(single(), 'a'))
  })

  test('activating a tab focuses its pane', () => {
    const l = moveToOtherPane(addTab(addTab(single(), 'a'), 'b'), 'b', 'row')
    expect(activate(l, 'a').focused).toBe(0)
    expect(activeOf(focusPane(l, 0))).toBe('a')
  })

  test('closing the last tab of a pane unsplits; otherwise the most recent tab takes over', () => {
    const l = moveToOtherPane(addTab(addTab(addTab(single(), 'a'), 'b'), 'c'), 'c', 'row')
    expect(removeTab(l, 'c', []).panes).toEqual([{ tabIds: ['a', 'b'], activeId: 'b' }])
    expect(removeTab(activate(l, 'b'), 'b', ['a']).panes[0].activeId).toBe('a')
  })

  test('unsplit merges panes in order', () => {
    const l = moveToOtherPane(addTab(addTab(single(), 'a'), 'b'), 'b', 'row')
    expect(unsplit(l).panes).toEqual([{ tabIds: ['a', 'b'], activeId: 'b' }])
  })
})
