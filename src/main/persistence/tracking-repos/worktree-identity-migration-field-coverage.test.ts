import { describe, expect, it } from 'vitest'
import {
  getDefaultPersistedState,
  getDefaultWorkspaceSession
} from '../../../shared/orca-profiles/constants'
import type { PersistedState } from '../../../shared/orca-profiles/persisted-state-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'

import { migrateWorktreeIdentity } from './worktree-identity-migration'
import { loadWorkspaceLayoutWithoutReport } from '../../../shared/workspace-layout/persistence/workspace-layout-load'
import { nameBasedLoadContext } from '../../../shared/workspace-layout/persistence/workspace-layout-minted-ids'

const REPO = 'repo'
const OLD = `${REPO}::/old/path`
const NEW = `${REPO}::/new/path`

type SessionField = keyof WorkspaceSessionState

const REFERENCE_FIXTURES: Partial<Record<SessionField, Partial<WorkspaceSessionState>>> = {
  clientHostedBrowserPagesByWorktree: {
    clientHostedBrowserPagesByWorktree: {
      [OLD]: [
        {
          v: 1,
          browserPageId: 'chp',
          workspaceId: OLD,
          browserProfileId: 'profile',
          url: 'https://e.com',
          title: 'E',
          pairedDeviceId: 'device',
          savedAt: 1
        }
      ]
    }
  },
  closedTerminalTabTombstonesByTabId: {
    closedTerminalTabTombstonesByTabId: { 'tab-1': { closedAt: 5, worktreeId: OLD } }
  }
}

function persistedState(session: WorkspaceSessionState): PersistedState {
  return { ...getDefaultPersistedState('/home/test'), workspaceSession: session }
}

describe('migrateWorktreeIdentity worktree-reference coverage', () => {
  it('rekeys each native window selection and view without changing its identity', () => {
    const session = { ...getDefaultWorkspaceSession(), activeWorktreeId: OLD }
    const view = loadWorkspaceLayoutWithoutReport(
      'local',
      session,
      nameBasedLoadContext()
    ).desktopView
    view.groups[OLD] = { group: { activeTabId: 'tab', recentTabIds: ['tab'] } }
    view.editorDrafts[OLD] = { file: { dirtyDraftContent: 'unsaved' } }
    const state = persistedState(session)
    state.ui.desktopWindows = {
      first: {
        open: true,
        ui: { lastActiveWorktreeId: `local|${OLD}` },
        viewsByHostId: { local: view }
      }
    }
    expect(migrateWorktreeIdentity(state, OLD, NEW)).toBe(true)
    const window = state.ui.desktopWindows.first
    expect(window.ui?.lastActiveWorktreeId).toBe(`local|${NEW}`)
    expect(window.viewsByHostId?.local.activeWorktreeId).toBe(NEW)
    expect(window.viewsByHostId?.local.groups[NEW]?.group.activeTabId).toBe('tab')
    expect(window.viewsByHostId?.local.editorDrafts[NEW]?.file.dirtyDraftContent).toBe('unsaved')
    expect(window.viewsByHostId?.local.groups).not.toHaveProperty(OLD)
  })

  // Collector checks keys only; rehydration also requires each row's workspaceId to match.
  it('re-points the workspaceId inside each client-hosted browser page row', () => {
    const session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      ...REFERENCE_FIXTURES.clientHostedBrowserPagesByWorktree
    }
    const state = persistedState(session)
    migrateWorktreeIdentity(state, OLD, NEW)
    expect(state.workspaceSession.clientHostedBrowserPagesByWorktree?.[NEW]?.[0]?.workspaceId).toBe(
      NEW
    )
  })

  it('migrates host partitions, not just the local blob', () => {
    const hostSession: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      ...REFERENCE_FIXTURES.closedTerminalTabTombstonesByTabId
    }
    const state = persistedState(getDefaultWorkspaceSession())
    state.workspaceSessionsByHostId = { 'ssh:target': hostSession }
    expect(migrateWorktreeIdentity(state, OLD, NEW)).toBe(true)
    expect(
      state.workspaceSessionsByHostId?.['ssh:target']?.closedTerminalTabTombstonesByTabId?.['tab-1']
        ?.worktreeId
    ).toBe(NEW)
  })

  it('re-keys a cross-store link by its child and never touches a parent in another store', () => {
    // A copied profile can name the same locator in the other store.
    const parent = {
      installationId: 'other-install',
      workspaceKey: 'worktree:repo::/old/path',
      instanceId: 'parent-instance'
    }
    const state = persistedState(getDefaultWorkspaceSession())
    state.crossStoreLineageByChildKey = {
      'worktree:repo::/old/path': { childWorkspaceKey: 'worktree:repo::/old/path', parent },
      'worktree:repo::/sibling': { childWorkspaceKey: 'worktree:repo::/sibling', parent }
    }

    expect(migrateWorktreeIdentity(state, OLD, NEW)).toBe(true)
    expect(state.crossStoreLineageByChildKey).toEqual({
      'worktree:repo::/new/path': {
        childWorkspaceKey: 'worktree:repo::/new/path',
        parent: {
          installationId: 'other-install',
          workspaceKey: 'worktree:repo::/old/path',
          instanceId: 'parent-instance'
        }
      },
      'worktree:repo::/sibling': {
        childWorkspaceKey: 'worktree:repo::/sibling',
        parent: {
          installationId: 'other-install',
          workspaceKey: 'worktree:repo::/old/path',
          instanceId: 'parent-instance'
        }
      }
    })
  })
})
