import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  CONVERSATION_SUMMARY_MAX_CHARS,
  type ConversationSummaryRecord
} from '../../shared/conversation-summary'

const StoredConversationSummary = z
  .object({
    sessionId: z.string().min(1).max(512),
    text: z.string().min(1).max(CONVERSATION_SUMMARY_MAX_CHARS),
    throughMessageCount: z.number().int().nonnegative(),
    throughMessageId: z.string().max(512),
    generatedAt: z.number().int().nonnegative(),
    edited: z.boolean(),
    agentLabel: z.string().max(256).optional()
  })
  .strict()

function summaryDirectory(): string {
  return join(getAppEnvironment().getPath('userData'), 'conversation-summaries')
}

function summaryFile(sessionId: string): string {
  return join(summaryDirectory(), `${createHash('sha256').update(sessionId).digest('hex')}.json`)
}

export async function saveConversationSummary(
  sessionId: string,
  record: ConversationSummaryRecord
): Promise<void> {
  await mkdir(summaryDirectory(), { recursive: true })
  const file = summaryFile(sessionId)
  const staging = `${file}.${randomUUID()}.tmp`
  await writeFile(staging, JSON.stringify({ sessionId, ...record }), { mode: 0o600 })
  await rename(staging, file)
}

export async function loadConversationSummary(
  sessionId: string
): Promise<ConversationSummaryRecord | null> {
  try {
    const parsed = StoredConversationSummary.safeParse(
      JSON.parse(await readFile(summaryFile(sessionId), 'utf8'))
    )
    if (!parsed.success || parsed.data.sessionId !== sessionId) {
      return null
    }
    const { sessionId: _sessionId, ...record } = parsed.data
    return record
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw new Error('The saved conversation summary could not be read.')
  }
}

/** Which of these chats have a saved summary; a file check, so a whole map costs no reads. */
export async function conversationSummarySessions(
  sessionIds: readonly string[]
): Promise<string[]> {
  const found = await Promise.all(
    sessionIds.map((sessionId) =>
      access(summaryFile(sessionId)).then(
        () => sessionId,
        () => null
      )
    )
  )
  return found.filter((sessionId): sessionId is string => sessionId !== null)
}
