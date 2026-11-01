import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentImageDisplayReceipt } from '../../../shared/agent-image-display'
import type { NativeChatImageRefBlock } from '../../../shared/native-chat-types'
import { nativeChatImageFileReference } from '../../../shared/native-chat-output-images'
import { isNativeLocalLocation } from '../../../shared/execution-host'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'

const identity = (id: string) => ({
  provider: 'orca' as const,
  clientMessageId: `image-display:${id}`
})

export function sessionImages(
  host: Pick<StructuredAgentSessionHost, 'deps'>,
  conversation: (id: string) => Promise<StructuredAgentSessionHostSession>
) {
  return new StructuredAgentSessionImages({
    store: { getRecord: (id) => host.deps.store.getRecord(id) },
    resolveWorkspacePath: (id) =>
      host.deps.resolveWorkspacePath?.(id) ??
      Promise.reject(new Error('image_display_workspace_unavailable')),
    journal: async (id) => (await conversation(id)).journal
  })
}

export class StructuredAgentSessionImages {
  constructor(
    private readonly deps: {
      store: Pick<StructuredAgentSessionHostDeps['store'], 'getRecord'>
      resolveWorkspacePath: StructuredAgentSessionHostDeps['resolveWorkspacePath']
      journal: (sessionId: string) => Promise<AgentSessionJournal>
    }
  ) {}

  snapshot = async (sessionId: string) => (await this.deps.journal(sessionId)).snapshot()

  private record(sessionId: string) {
    const record = this.deps.store.getRecord(sessionId)
    if (!record) {
      throw new Error('image_display_session_not_found')
    }
    if (!isNativeLocalLocation(record.location)) {
      throw new Error('image_display_wrong_host')
    }
    return record
  }

  private read(journal: AgentSessionJournal, id: string) {
    const item = journal
      .snapshot()
      .items.find((item) => item.itemId === agentJournalItemKey(identity(id)))
    const image =
      item?.body.kind === 'message'
        ? item.body.blocks.find((block) => block.type === 'image-ref' && block.display?.id === id)
        : undefined
    return image?.type === 'image-ref' && image.display && image.path ? { item, image } : null
  }

  async status(sessionId: string, id: string): Promise<AgentImageDisplayReceipt> {
    this.record(sessionId)
    const found = this.read(await this.deps.journal(sessionId), id)
    if (!found?.item || !found.image.display || !found.image.path) {
      throw new Error('image_display_not_found')
    }
    return { ...found.image.display, sessionId, path: found.image.path, itemId: found.item.itemId }
  }

  async show(input: {
    sessionId: string
    id: string
    path: string
    alt?: string
  }): Promise<AgentImageDisplayReceipt> {
    const record = this.record(input.sessionId)
    const directory = isAbsolute(input.path)
      ? ''
      : (record.launchDirectory ??
        (await this.deps.resolveWorkspacePath?.(record.location.workspaceId)))
    if (directory === undefined) {
      throw new Error('image_display_workspace_unavailable')
    }
    const path = resolve(directory, input.path)
    if (!nativeChatImageFileReference(path)) {
      throw new Error('image_display_not_an_image')
    }
    if (!(await stat(path)).isFile()) {
      throw new Error('image_display_not_a_file')
    }
    const journal = await this.deps.journal(input.sessionId)
    await journal.appendResolvedItem(
      () => {
        const existing = this.read(journal, input.id)
        if (existing) {
          if (existing.image.path !== path) {
            throw new Error('image_display_id_conflict')
          }
          return null
        }
        const image: NativeChatImageRefBlock = {
          type: 'image-ref',
          path,
          alt: input.alt,
          display: { id: input.id, state: 'pending' }
        }
        return {
          identity: identity(input.id),
          body: { kind: 'message', role: 'assistant', blocks: [image] }
        }
      },
      { fence: record.lease?.runtimeFence ?? 0, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
    return this.status(input.sessionId, input.id)
  }

  async report(input: {
    sessionId: string
    id: string
    state: 'loaded' | 'failed'
  }): Promise<AgentImageDisplayReceipt> {
    const record = this.record(input.sessionId)
    const journal = await this.deps.journal(input.sessionId)
    await journal.appendResolvedItem(
      () => {
        const found = this.read(journal, input.id)
        if (!found?.image.display || !found.item || found.item.body.kind !== 'message') {
          throw new Error('image_display_not_found')
        }
        if (found.image.display.state === input.state || found.image.display.state === 'loaded') {
          return null
        }
        return {
          identity: identity(input.id),
          body: {
            ...found.item.body,
            blocks: [{ ...found.image, display: { id: input.id, state: input.state } }]
          }
        }
      },
      { fence: record.lease?.runtimeFence ?? 0, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
    return this.status(input.sessionId, input.id)
  }
}
