// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorktreeAgentExpansionStateForTests,
  setAllWorktreeAgentListsCollapsed,
  useWorktreeAgentExpansionState
} from './worktree-card-agents-expansion-state'

function Probe({ worktreeId, paneKey }: { worktreeId: string; paneKey: string }) {
  const { isLineageParentExpanded, compactRootListExpanded, toggleLineageParent } =
    useWorktreeAgentExpansionState(worktreeId, undefined)
  return (
    <button
      type="button"
      data-pane={paneKey}
      data-expanded={isLineageParentExpanded(paneKey) ? 'true' : 'false'}
      data-list={compactRootListExpanded ? 'open' : 'closed'}
      onClick={() => toggleLineageParent(paneKey)}
    />
  )
}

describe('worktree agent list bulk collapse', () => {
  afterEach(() => clearWorktreeAgentExpansionStateForTests())

  it('reaches mounted and later-mounted cards, then yields to a manual toggle', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const read = (paneKey: string, attr = 'data-expanded') =>
      host.querySelector(`button[data-pane="${paneKey}"]`)!.getAttribute(attr)

    await act(async () => root.render(<Probe worktreeId="wt-a" paneKey="pane-x" />))
    expect(read('pane-x')).toBe('false')

    await act(async () => setAllWorktreeAgentListsCollapsed(false))
    expect(read('pane-x')).toBe('true')
    expect(read('pane-x', 'data-list')).toBe('open')

    await act(async () =>
      root.render(
        <>
          <Probe worktreeId="wt-a" paneKey="pane-x" />
          <Probe worktreeId="wt-b" paneKey="pane-y" />
          <Probe worktreeId="wt-b" paneKey="pane-z" />
        </>
      )
    )
    expect(read('pane-y')).toBe('true')

    await act(async () => {
      host
        .querySelector('button[data-pane="pane-y"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(read('pane-y')).toBe('false')
    expect(read('pane-z')).toBe('true')

    await act(async () => setAllWorktreeAgentListsCollapsed(true))
    expect(read('pane-x')).toBe('false')
    expect(read('pane-z')).toBe('false')
    expect(read('pane-z', 'data-list')).toBe('closed')

    await act(async () => root.unmount())
    host.remove()
  })
})
