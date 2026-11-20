import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { agentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { AgentImageDisplayReceipt } from '../../../../shared/agent-session/image-display/agent-image-display'
import type { NativeChatImageRefBlock } from '../../../../shared/native-chat/native-chat-types'
import { nativeChatImageFileReference } from '../../../../shared/native-chat/tools/native-chat-output-images'
import { isNativeLocalLocation } from '../../../../shared/execution-host/execution-host'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from '../host/structured-agent-session-host-types'
import type { AgentSessionJournal } from '../../agent-session-journal/journal-store'
import type { StructuredAgentSessionHost } from '../host/structured-agent-session-host'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../../shared/agent-session/journal/agent-session-journal-types'

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

const imagesByHost = new WeakMap<object, StructuredAgentSessionImages>()

// Why: the host class sits at its line limit, so its image owner is kept here, one per host.
export function hostImages(
  host: Pick<StructuredAgentSessionHost, 'deps' | 'conversation'> & {
    images?: StructuredAgentSessionImages
  }
): StructuredAgentSessionImages {
  let images = host.images ?? imagesByHost.get(host)
  if (!images) {
    images = sessionImages(host, host.conversation)
    imagesByHost.set(host, images)
  }
  return images
}

export class StructuredAgentSessionImages {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly deps: {
      store: Pick<StructuredAgentSessionHostDeps['store'], 'getRecord'>
      resolveWorkspacePath: StructuredAgentSessionHostDeps['resolveWorkspacePath']
      journal: (sessionId: string) => Promise<AgentSessionJournal>
    }
  ) {}

  // Why: the read-then-append of one display id must not interleave with another.
  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }

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

  private async read(journal: AgentSessionJournal, id: string) {
    const item = await journal.reads.itemDetail(agentJournalItemKey(identity(id)))
    const image =
      item?.body.kind === 'message'
        ? item.body.blocks.find((block) => block.type === 'image-ref' && block.display?.id === id)
        : undefined
    return item && image?.type === 'image-ref' && image.display && image.path
      ? { item, image }
      : null
  }

  async status(sessionId: string, id: string): Promise<AgentImageDisplayReceipt> {
    this.record(sessionId)
    const found = await this.read(await this.deps.journal(sessionId), id)
    if (!found?.image.display || !found.image.path) {
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
    await this.serialized(async () => {
      const existing = await this.read(journal, input.id)
      if (existing) {
        if (existing.image.path !== path) {
          throw new Error('image_display_id_conflict')
        }
        return
      }
      const image: NativeChatImageRefBlock = {
        type: 'image-ref',
        path,
        alt: input.alt,
        display: { id: input.id, state: 'pending' }
      }
      await journal.appendItem(
        identity(input.id),
        { kind: 'message', role: 'assistant', blocks: [image] },
        { fence: record.lease?.runtimeFence ?? 0, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
    })
    return this.status(input.sessionId, input.id)
  }

  async report(input: {
    sessionId: string
    id: string
    state: 'loaded' | 'failed'
  }): Promise<AgentImageDisplayReceipt> {
    const record = this.record(input.sessionId)
    const journal = await this.deps.journal(input.sessionId)
    await this.serialized(async () => {
      const found = await this.read(journal, input.id)
      if (!found?.image.display || found.item.body.kind !== 'message') {
        throw new Error('image_display_not_found')
      }
      if (found.image.display.state === input.state || found.image.display.state === 'loaded') {
        return
      }
      await journal.appendItem(
        identity(input.id),
        {
          ...found.item.body,
          blocks: [{ ...found.image, display: { id: input.id, state: input.state } }]
        },
        { fence: record.lease?.runtimeFence ?? 0, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
    })
    return this.status(input.sessionId, input.id)
  }
}
