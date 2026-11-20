import { describe, expect, it, vi } from 'vitest'
import {
  isPersistedAgentSessionRecord,
  type AgentSessionRecord
} from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionRecordFixture } from '../../../../shared/agent-session/lifecycle/records/agent-session-record.test-fixture'
import {
  decodePersistedAgentSessionRecord,
  encodeAgentSessionRecord
} from '../../../../shared/agent-session/lifecycle/records/agent-session-record-stored-form'
import { readChatSelection } from '../../../../shared/agent-session/options/protocol/agent-session-chat-capabilities'
import { applyAgentSessionRecordCommand } from '../../../runtime/agent-session/records/agent-session-record-command'
import { claudeAndCodexDeclared } from '../providers/testing/structured-agent-session-adapter-router.test-fixture'
import { recordStructuredAgentSessionOptionIntent } from './structured-agent-session-option-intent'
import { captureStructuredExecutionOptions } from './structured-agent-session-execution-options'

describe('conversation tool selection persistence', () => {
  it('retains a full installed-skill selection across save, reload and message admission', async () => {
    const agents = claudeAndCodexDeclared()
    let record: AgentSessionRecord = {
      ...agentSessionRecordFixture(),
      options: { model: 'sonnet' }
    }
    const otherConversation = agentSessionRecordFixture()
    const selection = {
      disabledSkills: Array.from({ length: 100 }, (_, index) => `installed-skill-${index}`),
      disabledMcpServers: ['zotero']
    }
    const encoded = JSON.stringify(selection)
    const store = {
      getRecord: () => record,
      replaceSessionOptions: vi.fn(),
      updateRecord: async (_sessionId, command) => {
        const applied = applyAgentSessionRecordCommand(record, command)
        record = applied.record
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the store answers each command with its own result.
        return applied.result as never
      }
    }
    const result = await recordStructuredAgentSessionOptionIntent(
      { store, agents },
      {
        sessionId: record.sessionId,
        fence: record.lease.runtimeFence,
        now: () => 10,
        publish: vi.fn()
      },
      { key: 'chatCapabilities', value: encoded }
    )
    expect(result.ok).toBe(true)
    const stored: unknown = JSON.parse(JSON.stringify(encodeAgentSessionRecord(record)))
    expect(isPersistedAgentSessionRecord(stored)).toBe(true)
    if (!isPersistedAgentSessionRecord(stored)) {
      throw new Error('record did not survive serialization')
    }
    const reloaded = decodePersistedAgentSessionRecord(stored).record
    expect(reloaded.options?.chatCapabilities).toBe(encoded)
    const captured = captureStructuredExecutionOptions(
      { agents, agent: 'claude', persistedOptions: reloaded.options },
      { model: 'opus' }
    )
    expect(captured).toMatchObject({ options: { model: 'opus', chatCapabilities: encoded } })
    expect(readChatSelection(otherConversation.options?.chatCapabilities)).toEqual({
      disabledSkills: [],
      disabledMcpServers: []
    })
  })
})
