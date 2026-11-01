import { IMAGE_FILE_EXTENSIONS } from './image-file-extensions'
import { nativeChatToolCategory } from './native-chat-tool-icon'
import { nativeChatToolLineLabel } from './native-chat-tool-line-label'
import { pairToolBlocks } from './native-chat-tool-pairs'
import type { NativeChatBlock, NativeChatImageRefBlock } from './native-chat-types'
import { nativeChatOutputImages } from './native-chat-output-images'

/** Successful calls and returned file paths display images without requiring assistant Markdown. */
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
    if (result) {
      nativeChatOutputImages(result.output).forEach(add)
    }
    if (
      call &&
      ['read', 'fileChange'].includes(nativeChatToolCategory(call.name, call.mcpIdentity) ?? '')
    ) {
      const { verb, filePath } = nativeChatToolLineLabel(call, result)
      if (
        filePath &&
        ['read', 'added', 'edited'].includes(verb ?? '') &&
        IMAGE_FILE_EXTENSIONS.some((extension) => filePath.toLowerCase().endsWith(extension))
      ) {
        add({ type: 'image-ref', path: filePath })
      }
    }
  }
  return images
}
