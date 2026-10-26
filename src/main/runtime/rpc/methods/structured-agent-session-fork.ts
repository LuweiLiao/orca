// `agentSession.fork`: a new chat that starts from another chat's conversation, recorded so the
// project map can draw where it came from. `agentSession.lineage`: those records.

import type { z } from 'zod'
import { defineMethod, type RpcContext } from '../core'
import {
  ForkParams,
  LineageParams,
  agentSessionForkFingerprint,
  type AgentSessionForkResult,
  type AgentSessionLineageEntry
} from '../../../../shared/agent-session-fork'
import { agentSessionFingerprintConflict } from '../../../../shared/agent-session-mutation-envelope'
import type { AgentSessionMutationResult } from '../../../../shared/agent-session-wire'
import { AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY } from '../../../../shared/agent-session-create-capabilities'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { AgentSessionRecord } from '../../../../shared/agent-session-record'
import { conversationNameSeed } from '../../../../shared/conversation-name-generation'
import { agentSessionLineageTable } from '../../../native-chat/agent-session-journal/agent-session-lineage-table'
import {
  copyClaudeForkSource,
  forkHandoffText,
  forkSourceMessages
} from '../../../native-chat/agent-session-fork-source'
import { assertPersonCreatesAgent } from './agent-creation-caller-admission'
import {
  ensureStructuredHostInstalled as ensureHostInstalled,
  requireStructuredAgentAudience,
  requireStructuredHost as requireHost,
  structuredCallerFor as callerFor
} from './structured-agent-session-gate'
import {
  commitStructuredAgentSessionCreate,
  prepareStructuredAgentSessionCreateForWorktree,
  structuredAgentSessionCreateIntentFingerprint
} from './structured-agent-session-create'
import { resolveUncommittedStructuredCreate } from './structured-agent-session-precommit-refusal'

type ForkResult =
  | { ok: true; value: AgentSessionForkResult }
  | Extract<AgentSessionMutationResult<unknown>, { ok: false }>

async function forkStructuredAgentSession(
  params: z.infer<typeof ForkParams>,
  ctx: RpcContext
): Promise<ForkResult> {
  requireStructuredAgentAudience(ctx, params.agent)
  assertPersonCreatesAgent(ctx, 'agentSession.fork')
  const conflict = agentSessionFingerprintConflict(
    params.envelope,
    agentSessionForkFingerprint(params)
  )
  if (conflict) {
    return { ok: false, refusal: conflict }
  }
  await ensureHostInstalled(ctx)
  const host = requireHost(ctx)
  const lineage = agentSessionLineageTable(host.deps.journalDatabase)
  const childSessionId = params.envelope.sessionId
  const recorded = lineage.get(childSessionId)
  if (recorded && host.deps.store.getRecord(childSessionId)) {
    // A replay of a fork that already made its chat.
    return {
      ok: true,
      value: {
        sessionId: childSessionId,
        mode: recorded.mode,
        messageCount: recorded.cut.messageCount
      }
    }
  }
  const source = host.deps.store.getRecord(params.sourceSessionId)
  if (
    !source ||
    source.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    source.location.wslDistro !== null
  ) {
    throw new Error('The source chat is not on this host, so it cannot be continued here.')
  }
  const forkPoint = params.cut.kind === 'fork-point' ? lineage.get(params.cut.childSessionId) : null
  if (forkPoint && forkPoint.sourceSessionId !== params.sourceSessionId) {
    throw new Error('That fork point belongs to another chat.')
  }
  if (params.cut.kind === 'latest') {
    const page = await host.history({ sessionId: source.sessionId, direction: 'tail', limit: 1 })
    if (page.page.working) {
      throw new Error('The source chat is still working. Start from it after its turn ends.')
    }
  }
  const taken = forkSourceMessages(
    await host.journalSnapshot(source.sessionId),
    params.cut,
    forkPoint
  )
  const [sourcePath, childPath] = await Promise.all([
    ctx.runtime.resolveStructuredAgentSessionLocalWorkspacePath(
      `id:${source.location.workspaceId}`
    ),
    ctx.runtime.resolveStructuredAgentSessionLocalWorkspacePath(params.worktree)
  ])
  // A Claude copy resumes only where Claude stored it: the same agent in the same workspace.
  const copy =
    params.agent === 'claude' && sourcePath && sourcePath === childPath
      ? await copyClaudeForkSource({
          host,
          source,
          forkPoint: forkPoint?.cut,
          workspaceCwd: sourcePath
        })
      : null
  const entry: AgentSessionLineageEntry = {
    childSessionId,
    sourceSessionId: source.sessionId,
    originSessionId: params.originSessionId,
    mode: copy ? 'native' : 'transcript',
    cut: copy
      ? {
          ...taken.cut,
          providerSessionId: copy.copyOf,
          providerMessageId: copy.lastSourceMessageId
        }
      : taken.cut,
    sourceProvider: source.provider,
    createdAt: Date.now()
  }
  const text = copy
    ? params.instruction?.trim()
    : forkHandoffText({ source, messages: taken.messages, instruction: params.instruction })
  const firstMessage = text
    ? {
        clientMessageId: `fork-${params.envelope.clientOperationId}`,
        body: {
          kind: 'message' as const,
          role: 'user' as const,
          blocks: [{ type: 'text' as const, text }]
        }
      }
    : undefined
  const intent = {
    envelope: params.envelope,
    worktree: params.worktree,
    agent: params.agent,
    ...(copy ? { resumeFrom: { providerSessionId: copy.providerSessionId } } : {}),
    ...(params.options ? { options: params.options } : {}),
    ...(firstMessage ? { firstMessage } : {})
  }
  const envelope = {
    ...params.envelope,
    payloadFingerprint: structuredAgentSessionCreateIntentFingerprint(intent)
  }
  // Recorded first: a chat that exists with no record of where it came from would draw unlinked.
  lineage.put(entry)
  const prepared = await resolveUncommittedStructuredCreate(() =>
    prepareStructuredAgentSessionCreateForWorktree({
      runtime: ctx.runtime,
      ensureHost: async () => host,
      caller: callerFor(ctx),
      structuredAgentCliSourceEvidence: ctx.structuredAgentCliSourceEvidence,
      ...intent,
      envelope,
      atRest: Boolean(
        firstMessage ||
        ctx.clientCapabilities?.includes(AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY)
      )
    })
  )
  if ('refusal' in prepared) {
    lineage.delete(childSessionId)
    return { ok: false, refusal: prepared.refusal }
  }
  const created = await commitStructuredAgentSessionCreate({
    runtime: ctx.runtime,
    caller: callerFor(ctx),
    prepared,
    // The person stays on the map; the new chat opens in its window there.
    activate: false,
    placedByWindow: ctx.caller?.kind === 'desktop'
  })
  if (!created.ok) {
    return created
  }
  await nameForkedChat(ctx, host, created.value.sessionId, source, params.instruction)
  return {
    ok: true,
    value: {
      sessionId: created.value.sessionId,
      mode: entry.mode,
      messageCount: entry.cut.messageCount,
      ...(created.value.tabId ? { tabId: created.value.tabId } : {})
    }
  }
}

/**
 * Named before the namer reads the first message, which for a hand-off is the transferred
 * conversation, not what the person asked this child to do.
 */
async function nameForkedChat(
  ctx: RpcContext,
  host: ReturnType<typeof requireHost>,
  sessionId: string,
  source: AgentSessionRecord,
  instruction: string | undefined
): Promise<void> {
  const name =
    conversationNameSeed(instruction ?? '') ??
    (source.conversationName ? `Fork of ${source.conversationName}` : null)
  if (!name) {
    return
  }
  try {
    const named = await host.deps.store.compareAndSetConversationName(sessionId, name, null, 'seed')
    if (named) {
      ctx.runtime.refreshStructuredConversationTabTitle(named.location.workspaceId, sessionId)
    }
  } catch (error) {
    host.deps.logger.warn('naming a forked chat failed', { scope: 'fork-name', sessionId, error })
  }
}

export const STRUCTURED_AGENT_SESSION_FORK_METHODS = [
  defineMethod({
    name: 'agentSession.fork',
    permission: 'workspace',
    params: ForkParams,
    handler: forkStructuredAgentSession
  }),
  defineMethod({
    name: 'agentSession.lineage',
    permission: 'workspace',
    params: LineageParams,
    handler: async (params, ctx) => {
      await ensureHostInstalled(ctx)
      const host = requireHost(ctx)
      const wanted = params.sessionIds ? new Set(params.sessionIds) : null
      // A fork that never made its chat leaves an entry with no record; it is not drawn.
      const entries = agentSessionLineageTable(host.deps.journalDatabase)
        .list()
        .filter(
          (entry) =>
            host.deps.store.getRecord(entry.childSessionId) &&
            (!wanted || wanted.has(entry.childSessionId) || wanted.has(entry.sourceSessionId))
        )
      return { entries }
    }
  })
]
