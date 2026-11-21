import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import {
  isAgentSessionReferenceLink,
  type AgentSessionReferenceLink
} from '../../shared/agent-session/agent-session-reference-link'

const LINK_FILE = 'conversation-reference-links.jsonl'

const linkKey = (link: AgentSessionReferenceLink): string =>
  `${link.targetSessionId}\n${link.messageId}\n${link.referenceUri}`

function linkPath(): { directory: string; file: string } {
  const directory = join(getAppEnvironment().getPath('userData'), 'conversation-references')
  return { directory, file: join(directory, LINK_FILE) }
}

/** One line per link; a line a newer build wrote that this one cannot read is skipped. */
export async function listConversationReferenceLinks(): Promise<AgentSessionReferenceLink[]> {
  let raw: string
  try {
    raw = await readFile(linkPath().file, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
  const links = new Map<string, AgentSessionReferenceLink>()
  for (const line of raw.split('\n')) {
    try {
      const value: unknown = JSON.parse(line)
      if (isAgentSessionReferenceLink(value)) {
        links.set(linkKey(value), value)
      }
    } catch {
      continue
    }
  }
  return [...links.values()]
}

/** A replayed send records the same links again; the key keeps one of each. */
export async function saveConversationReferenceLinks(
  links: readonly AgentSessionReferenceLink[]
): Promise<void> {
  if (links.length === 0) {
    return
  }
  const known = new Set((await listConversationReferenceLinks()).map(linkKey))
  const fresh = links.filter((link) => !known.has(linkKey(link)))
  if (fresh.length === 0) {
    return
  }
  const { directory, file } = linkPath()
  await mkdir(directory, { recursive: true })
  await appendFile(file, `${fresh.map((link) => JSON.stringify(link)).join('\n')}\n`, {
    mode: 0o600
  })
}
