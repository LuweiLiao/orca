import type { OpenFile } from '@/store/slices/editor'
import { useAppStore } from '@/store'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { editorTabFileAccess, isClientLocalReadOnlyTab } from '@/lib/local-file-access'
import { requireRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import { dirname } from '@/lib/path'
import type { RuntimeFileReadArgs } from '@/runtime/runtime-file-client-types'
import {
  readRuntimeFileChunk,
  statRuntimeReadTarget,
  type RuntimeFileSnapshot
} from '@/runtime/runtime-file-range-client'
import { readFileInChunks } from '@/runtime/runtime-paged-file-read'
import { parseSynctex, type SynctexData } from './pdf-synctex-parser'

// Why two: a forward search may probe a couple of open PDFs; a thesis's index is tens of MB.
const CACHE_LIMIT = 2
const cache = new Map<string, { stamp: string; data: Promise<SynctexData | null> }>()

/** Read args for the file beside `pdf` with `suffix` in place of `.pdf`, on the PDF's own host. */
function sidecarReadArgs(pdf: OpenFile, suffix: string): RuntimeFileReadArgs | null {
  // Why: a granted file reads only through its grant, which never covers a sibling.
  if (pdf.terminalArtifactGrantId) {
    return null
  }
  const state = useAppStore.getState()
  const clientLocal = isClientLocalReadOnlyTab(pdf)
  const target =
    clientLocal && pdf.runtimeEnvironmentId === undefined
      ? ({ kind: 'local' } as const)
      : requireRuntimeTargetForFileOwner(state, pdf.worktreeId, pdf.runtimeEnvironmentId)
  const external = pdf.relativePath === pdf.filePath
  const connectionId = clientLocal
    ? undefined
    : external && !pdf.externalSshTargetId?.trim()
      ? undefined
      : (getConnectionIdForFile(pdf.worktreeId, pdf.filePath) ?? undefined)
  const sidecarPath = pdf.filePath.replace(/\.pdf$/i, suffix)
  return {
    target,
    filePath: sidecarPath,
    relativePath: external ? sidecarPath : pdf.relativePath.replace(/\.pdf$/i, suffix),
    worktreeId: pdf.worktreeId,
    connectionId,
    expectedExternalSshTargetId: pdf.externalSshTargetId,
    access: editorTabFileAccess(state, pdf)
  }
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  // Why copy: Blob takes only ArrayBuffer-backed views, and the chunk read may share its buffer.
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function readSynctex(
  args: RuntimeFileReadArgs,
  gzipped: boolean
): Promise<SynctexData | null> {
  const read = await readFileInChunks({
    stat: () => statRuntimeReadTarget(args),
    readChunk: (offset, length) => readRuntimeFileChunk(args, offset, length)
  })
  if (read.kind !== 'ok') {
    return null
  }
  const text = gzipped ? await gunzip(read.bytes) : new TextDecoder().decode(read.bytes)
  return parseSynctex(text, dirname(args.filePath))
}

/**
 * The SyncTeX index TeX wrote beside `pdf` (`.synctex.gz`, else `.synctex`), or null when there
 * is none or it cannot be read. Cached per file version, so repeat jumps do not re-read it.
 */
export async function loadPdfSynctex(pdf: OpenFile): Promise<SynctexData | null> {
  if (!/\.pdf$/i.test(pdf.filePath)) {
    return null
  }
  for (const suffix of ['.synctex.gz', '.synctex']) {
    let args: RuntimeFileReadArgs | null
    let snapshot: RuntimeFileSnapshot
    try {
      args = sidecarReadArgs(pdf, suffix)
      if (!args) {
        return null
      }
      snapshot = await statRuntimeReadTarget(args)
    } catch {
      continue
    }
    const key = `${pdf.worktreeId}::${args.filePath}`
    const stamp = `${snapshot.size}:${snapshot.mtime}:${snapshot.ctime ?? ''}`
    const cached = cache.get(key)
    if (cached?.stamp === stamp) {
      return cached.data
    }
    const data = readSynctex(args, suffix.endsWith('.gz')).catch(() => null)
    cache.delete(key)
    cache.set(key, { stamp, data })
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) {
        break
      }
      cache.delete(oldest)
    }
    return data
  }
  return null
}
