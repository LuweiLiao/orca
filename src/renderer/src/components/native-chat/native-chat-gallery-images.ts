import type { Nodes } from 'mdast'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { unified } from 'unified'
import type {
  NativeChatImageRefBlock,
  NativeChatMessage
} from '../../../../shared/native-chat-types'
import { deriveNativeChatRowContent } from '../../../../shared/native-chat-row-content'
import {
  createNativeChatFileHref,
  routeNativeChatHref
} from '../../../../shared/native-chat-href-routing'
import { remarkNativeChatImageFileLinks } from './native-chat-image-file-links'

export type NativeChatGalleryImage = {
  messageId: string
  source: string
  block: NativeChatImageRefBlock
}

const parser = unified().use(remarkParse).use(remarkGfm)
const rowImages = new WeakMap<NativeChatMessage['blocks'], NativeChatImageRefBlock[]>()

export function nativeChatGallerySource(source: string): string {
  const route = routeNativeChatHref(source)
  return route.kind === 'file' ? route.pathText : source
}

function markdownImages(markdown: string): NativeChatImageRefBlock[] {
  const tree = parser.parse(markdown)
  remarkNativeChatImageFileLinks()(tree)
  const definitions = new Map<string, string>()
  const images: NativeChatImageRefBlock[] = []
  const visit = (node: Nodes, collect: boolean): void => {
    if (node.type === 'definition') {
      definitions.set(node.identifier, node.url)
    }
    if (collect && (node.type === 'image' || node.type === 'imageReference')) {
      const source = node.type === 'image' ? node.url : definitions.get(node.identifier)
      if (source) {
        images.push({ type: 'image-ref', url: source, alt: node.alt ?? undefined })
      }
    }
    if ('children' in node) {
      node.children.forEach((child) => visit(child, collect))
    }
  }
  visit(tree, false)
  visit(tree, true)
  return images
}

/** Read the transcript, including windowed-out rows, in the order its images are drawn. */
export function nativeChatGalleryImages(
  messages: readonly NativeChatMessage[]
): NativeChatGalleryImage[] {
  return messages.flatMap((message) => {
    let images = rowImages.get(message.blocks)
    if (!images) {
      const { prose, markdown } = deriveNativeChatRowContent(message.blocks)
      images = [...prose.filter((block) => block.type === 'image-ref'), ...markdownImages(markdown)]
      rowImages.set(message.blocks, images)
    }
    const seen = new Set<string>()
    return images.flatMap((block) => {
      const raw = block.url || block.path
      if (!raw) {
        return []
      }
      const source = nativeChatGallerySource(
        block.path ? createNativeChatFileHref(block.path, 'literal') : raw
      )
      if (seen.has(source)) {
        return []
      }
      seen.add(source)
      return [{ messageId: message.id, source, block }]
    })
  })
}

export function nativeChatGalleryImageHref(image: NativeChatGalleryImage): string {
  return image.block.path
    ? createNativeChatFileHref(image.block.path, 'literal')
    : (image.block.url ?? '')
}
