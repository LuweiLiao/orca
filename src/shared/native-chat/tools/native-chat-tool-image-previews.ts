import { IMAGE_FILE_EXTENSIONS } from '../../file-preview/image-mime-types'
import type { NativeChatBlock, NativeChatImageRefBlock } from '../native-chat-types'
import { nativeChatOutputImages } from './native-chat-output-images'
import { nativeChatToolCategory } from './native-chat-tool-icon'
import { nativeChatToolLineLabel } from './native-chat-tool-line-label'
import { nativeChatToolInputText } from './native-chat-tool-input-text'
import { normalizeToolInput } from './native-chat-tool-summary'
import { pairToolBlocks } from './native-chat-tool-pairs'
import { isRuntimePathAbsolute, resolveRuntimePath } from '../../file-access/cross-platform-path'

function toolImageDirectory(input: unknown): string | null {
  const normalized = normalizeToolInput(input)
  let workdir: string | null = null
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const fields = new Map(Object.entries(normalized))
    for (const key of ['workdir', 'cwd', 'workingDirectory']) {
      const directory = fields.get(key)
      if (typeof directory === 'string' && isRuntimePathAbsolute(directory)) {
        workdir = directory
        break
      }
    }
  }
  const command = nativeChatToolInputText(input, 'command') ?? nativeChatToolInputText(input, 'cmd')
  const match = command?.match(
    /^\s*(?:cd(?:\s+\/d)?|Set-Location(?:\s+-(?:LiteralPath|Path))?)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;|\r?\n)/i
  )
  if (!match) {
    return workdir
  }
  const directory = match?.[1] ?? match?.[2] ?? match?.[3]
  const remainder = command?.slice(match[0].length) ?? ''
  if (
    !directory ||
    /[$`]/.test(directory) ||
    /(?:^|[;&|\r\n])\s*(?:cd|pushd|popd|Set-Location)\b/i.test(remainder)
  ) {
    return null
  }
  return workdir
    ? resolveRuntimePath(workdir, directory)
    : isRuntimePathAbsolute(directory)
      ? directory
      : null
}

/** Returned image paths and written image files show without assistant Markdown; reads belong to the viewed-images rule. */
export function nativeChatToolImagePreviews(
  blocks: readonly NativeChatBlock[]
): NativeChatImageRefBlock[] {
  const seen = new Set(
    blocks.flatMap((block) => (block.type === 'image-ref' ? [block.path ?? block.url ?? ''] : []))
  )
  const images: NativeChatImageRefBlock[] = []
  const add = (image: NativeChatImageRefBlock): void => {
    const key = image.path ?? image.url
    if (key && !seen.has(key)) {
      seen.add(key)
      images.push(image)
    }
  }
  for (const { call, result } of pairToolBlocks(blocks)) {
    if (
      result?.isError ||
      call?.state === 'failed' ||
      call?.state === 'running' ||
      (call?.exitCode !== undefined && call.exitCode !== 0)
    ) {
      continue
    }
    const workdir = call ? toolImageDirectory(call.input) : null
    if (result) {
      nativeChatOutputImages(result.output).forEach((image) => {
        if (!image.path || /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(image.path)) {
          add(image)
          return
        }
        if (workdir) {
          add({ ...image, path: resolveRuntimePath(workdir, image.path) })
        }
      })
    }
    if (call && nativeChatToolCategory(call.name, call.mcpIdentity) === 'fileChange') {
      const { verb, filePath } = nativeChatToolLineLabel(call, result)
      if (
        filePath &&
        (verb === 'added' || verb === 'edited') &&
        IMAGE_FILE_EXTENSIONS.some((extension) => filePath.toLowerCase().endsWith(extension))
      ) {
        add({
          type: 'image-ref',
          path:
            workdir && !/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(filePath)
              ? resolveRuntimePath(workdir, filePath)
              : filePath
        })
      }
    }
  }
  return images
}
