import { createHash } from 'node:crypto'
import type {
  ConversationReferenceRead,
  ConversationReferencePage,
  ConversationSource
} from '../../shared/conversation-reference'
import { wslGatedStat } from '../native-chat/transcript-filesystem/wsl-transcript-fs-access'
import { parseAgentSessionFile } from './parsing/session-scanner-agent-parser'
import {
  splitOpenCodeSqliteCandidate,
  buildOpenCodeSqliteCandidatePath
} from '../../shared/agent-session/lifecycle/provider-handles/opencode-sqlite-session-path'
import { collectConversationReferencePage } from './conversation-reference-page'
import { withOpenCodeSqliteScanScope } from './scanners/opencode/sqlite/session-scanner-opencode-sqlite-scan-scope'
import { withDevinSessionsDbScan } from './scanners/devin/session-scanner-devin-db'
import { withFullTranscriptText } from './transcripts/session-transcript-message-content'
import { configureOpenCodeWslReaders } from './scanners/opencode/reader-transport/session-scanner-opencode-wsl-client'
import type { OpenCodeWslRuntime } from './scanners/opencode/reader-transport/session-scanner-opencode-wsl-runtime'
import { toHostReadableTranscriptPath } from '../native-chat/transcript-discovery/host-readable-transcript-path'

export type ConversationTranscriptRead = {
  id: string
  source: Extract<ConversationSource, { kind: 'transcript' }>
  request: ConversationReferenceRead
  wslOpenCodeReaders?: readonly OpenCodeWslRuntime[]
}

export async function readConversationTranscript(
  input: ConversationTranscriptRead,
  signal?: AbortSignal
): Promise<Omit<ConversationReferencePage, 'reference'>> {
  const { source, request, id } = input
  if (input.wslOpenCodeReaders) {
    configureOpenCodeWslReaders(input.wslOpenCodeReaders)
  }
  if (!source.filePath) {
    throw new Error('The reference has no saved source location. Attach it again.')
  }
  const sqlite = splitOpenCodeSqliteCandidate(
    source.filePath,
    source.agent === 'zcode' ? 'zcode' : 'opencode'
  )
  const path = await toHostReadableTranscriptPath(sqlite?.dbPath ?? source.filePath, { signal })
  if (!path) {
    throw new Error('The source conversation file is unavailable.')
  }
  const before = await wslGatedStat(path, 'exact', signal)
  const version = createHash('sha256')
    .update(`${before.size}:${before.mtimeMs}:${before.ino}`)
    .digest('hex')
  const page = collectConversationReferencePage(id, version, request)
  const candidatePath =
    sqlite ||
    ((source.agent === 'opencode' || source.agent === 'opencode2' || source.agent === 'zcode') &&
      /\.(db|sqlite)$/.test(path))
      ? buildOpenCodeSqliteCandidatePath(path, source.sessionId)
      : path
  const session = await withFullTranscriptText(() =>
    withDevinSessionsDbScan(() =>
      withOpenCodeSqliteScanScope(() =>
        parseAgentSessionFile(
          {
            agent: source.agent,
            codexHome: source.codexHome ?? null,
            file: {
              path: candidatePath,
              mtimeMs: before.mtimeMs,
              modifiedAt: before.mtime.toISOString(),
              sizeBytes: before.size
            }
          },
          process.platform,
          { active: true, push: page.push, reset: page.reset },
          signal
        )
      )
    )
  )
  signal?.throwIfAborted()
  if (!session || session.sessionId !== source.sessionId) {
    throw new Error('The source file no longer matches the referenced conversation.')
  }
  const after = await wslGatedStat(path, 'exact', signal)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error('The conversation changed while reading it. Retry without --cursor.')
  }
  return page.finish()
}
