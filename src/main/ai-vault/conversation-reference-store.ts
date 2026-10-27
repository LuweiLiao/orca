import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { getAppEnvironment } from '../../shared/app-environment'
import {
  ConversationSourceSchema,
  conversationReferenceUri,
  type ConversationReference,
  type ConversationReferenceCreate
} from '../../shared/conversation-reference'

const StoredConversationReference = z
  .object({
    source: ConversationSourceSchema,
    title: z.string().min(1).max(1024),
    agent: z.string().min(1).max(128)
  })
  .strict()

export type StoredConversationReference = z.infer<typeof StoredConversationReference>

/**
 * Where a structured reference stops reading: the source as it stood when the reference was made.
 * Kept beside the reference, never in it: `StoredConversationReference` is strict, so a field
 * added there would make an older Orca refuse the whole reference instead of reading it live.
 */
const StoredConversationReferenceCut = z.object({
  journalItemId: z.string().min(1).max(512),
  journalEpoch: z.string().min(1).max(512),
  journalSequence: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative()
})

export type ConversationReferenceCut = z.infer<typeof StoredConversationReferenceCut>

function referenceDirectory(): string {
  return join(getAppEnvironment().getPath('userData'), 'conversation-references')
}

export async function saveConversationReference(
  source: ConversationReferenceCreate,
  agent: string,
  cut?: ConversationReferenceCut
): Promise<ConversationReference> {
  const id = randomUUID()
  const directory = referenceDirectory()
  await mkdir(directory, { recursive: true })
  // Written first: a reference saved without its cut would read live, a cut alone reads nothing.
  if (cut) {
    await writeFile(join(directory, `${id}.cut.json`), JSON.stringify(cut), {
      flag: 'wx',
      mode: 0o600
    })
  }
  await writeFile(
    join(directory, `${id}.json`),
    JSON.stringify({
      source: source.source,
      title: source.title,
      agent
    }),
    { flag: 'wx', mode: 0o600 }
  )
  return {
    uri: conversationReferenceUri(id, source.executionHostId, cut?.messageCount),
    title: source.title,
    agent
  }
}

/** The reference's cut, or null for one that reads its source live. */
export async function loadConversationReferenceCut(
  id: string
): Promise<ConversationReferenceCut | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return null
  }
  try {
    const parsed = StoredConversationReferenceCut.safeParse(
      JSON.parse(await readFile(join(referenceDirectory(), `${id}.cut.json`), 'utf8'))
    )
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw new Error('The saved conversation reference could not be read.')
  }
}

export async function loadConversationReference(
  id: string
): Promise<StoredConversationReference | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return null
  }
  try {
    return StoredConversationReference.parse(
      JSON.parse(await readFile(join(referenceDirectory(), `${id}.json`), 'utf8'))
    )
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw new Error('The saved conversation reference could not be read.')
  }
}
