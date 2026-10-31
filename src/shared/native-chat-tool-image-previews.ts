import { IMAGE_FILE_EXTENSIONS } from './image-file-extensions'
import { nativeChatToolCategory } from './native-chat-tool-icon'
import { nativeChatToolLineLabel } from './native-chat-tool-line-label'
import { pairToolBlocks } from './native-chat-tool-pairs'
import type { NativeChatBlock, NativeChatImageRefBlock } from './native-chat-types'

/** Read results can omit image bytes; their successful call still names the host's file. */
export function nativeChatToolImagePreviews(
  blocks: readonly NativeChatBlock[]
): NativeChatImageRefBlock[] {
  const seen = new Set(
    blocks.flatMap((block) => (block.type === 'image-ref' && block.path ? [block.path] : []))
  )
  const images: NativeChatImageRefBlock[] = []
  for (const { call, result } of pairToolBlocks(blocks)) {
    if (!call || nativeChatToolCategory(call.name, call.mcpIdentity) !== 'read') {
      continue
    }
    const { verb, filePath } = nativeChatToolLineLabel(call, result)
    if (verb !== 'read' || !filePath || seen.has(filePath)) {
      continue
    }
    if (IMAGE_FILE_EXTENSIONS.some((extension) => filePath.toLowerCase().endsWith(extension))) {
      seen.add(filePath)
      images.push({ type: 'image-ref', path: filePath })
    }
  }
  return images
}
