import { nativeChatImageFileReference } from '../../../../shared/native-chat-output-images'
import {
  createNativeChatFileHref,
  routeNativeChatHref
} from '../../../../shared/native-chat-href-routing'
import { remarkNativeChatFileLinks } from '@/components/sidebar/comment-markdown-native-chat-file-links'

type MarkdownNode = {
  type: string
  url?: string
  alt?: string
  children?: MarkdownNode[]
}

function imageSource(url: string | undefined): string | null {
  const route = routeNativeChatHref(url)
  const image = url
    ? nativeChatImageFileReference(
        route.kind === 'file' ? createNativeChatFileHref(route.pathText, 'literal') : url
      )
    : null
  return image?.path ? createNativeChatFileHref(image.path, 'literal') : (image?.url ?? null)
}

/** Reuse file-link parsing; image bytes and existence still resolve through the conversation host. */
export function remarkNativeChatImageFileLinks(): (tree: MarkdownNode) => void {
  return (tree) => {
    const linkPaths = remarkNativeChatFileLinks(
      (link) => nativeChatImageFileReference(link.pathText) !== null
    )()
    const seen = new Set<string>()
    const collect = (node: MarkdownNode): void => {
      if (node.type === 'image') {
        const source = imageSource(node.url)
        if (source) {
          seen.add(source)
        }
      }
      node.children?.forEach(collect)
    }
    collect(tree)
    const transform = (node: MarkdownNode): void => {
      if (!node.children || node.type === 'link' || node.type === 'image') {
        return
      }
      node.children = node.children.flatMap((child) => {
        const fragment = { type: 'paragraph', children: [child] }
        if (child.type === 'text' || child.type === 'inlineCode') {
          linkPaths(fragment)
        }
        return fragment.children.flatMap((candidate) => {
          const source = candidate.type === 'link' ? imageSource(candidate.url) : null
          if (source && !seen.has(source)) {
            seen.add(source)
            return [candidate, { type: 'image', url: source, alt: '' }]
          }
          transform(candidate)
          return [candidate]
        })
      })
    }
    transform(tree)
  }
}
