import { IMAGE_FILE_EXTENSIONS } from './image-file-extensions'
import { routeNativeChatHref } from './native-chat-href-routing'
import type { NativeChatImageRefBlock } from './native-chat-types'

const IMAGE_SUFFIX = new RegExp(
  `\\.(?:${IMAGE_FILE_EXTENSIONS.map((extension) => extension.slice(1)).join('|')})$`,
  'i'
)
const OUTPUT_PATH = new RegExp(
  `(?:https?://|file:///|[A-Za-z]:[\\\\/]|\\.{1,2}/|~/|/|[\\p{L}\\p{N}._-]+[\\\\/])[^\\s\x22\x27\x60<>|]*?\\.(?:${IMAGE_FILE_EXTENSIONS.map((extension) => extension.slice(1)).join('|')})(?=$|[\\s\x22\x27\x60<>),;，。])`,
  'giu'
)

export function nativeChatImageFileReference(value: string): NativeChatImageRefBlock | null {
  const source = value.trim()
  if (/[\r\n]/.test(source)) {
    return null
  }
  const route = routeNativeChatHref(source)
  if (route.kind === 'web' && /^https?:/i.test(route.url)) {
    try {
      return IMAGE_SUFFIX.test(new URL(route.url).pathname)
        ? { type: 'image-ref', url: route.url }
        : null
    } catch {
      return null
    }
  }
  if (route.kind !== 'file' || route.line !== null) {
    return null
  }
  const path =
    source.startsWith('file:') || source.startsWith('#orca-native-chat-file')
      ? route.pathText
      : source
  return IMAGE_SUFFIX.test(path) &&
    (!/\s/.test(path) || /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~[\\/])/.test(path))
    ? { type: 'image-ref', path }
    : null
}

/** Only returned output is inspected; a command's source is not proof it produced a file. */
export function nativeChatOutputImages(output: string): NativeChatImageRefBlock[] {
  const images: NativeChatImageRefBlock[] = []
  const add = (value: string): void => {
    const image = nativeChatImageFileReference(value)
    if (image) {
      images.push(image)
    }
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value && typeof value === 'object') {
      const fields = new Map(Object.entries(value))
      if (
        typeof fields.get('itemId') === 'string' &&
        typeof fields.get('sessionId') === 'string' &&
        ['pending', 'loaded', 'failed'].includes(String(fields.get('state')))
      ) {
        return
      }
      Object.values(value).forEach(visit)
    } else if (typeof value === 'string') {
      const image = nativeChatImageFileReference(value)
      if (image) {
        images.push(image)
        return
      }
      try {
        visit(JSON.parse(value))
        return
      } catch {
        // CLI stdout and MCP text blocks can report paths without JSON.
      }
      for (const line of value.split(/\r?\n/)) {
        const quoted = [...line.matchAll(/[`"']([^`"'\r\n]+)[`"']/g)]
        for (const match of quoted) {
          add(match[1])
        }
        const remaining = line.replace(/[`"']([^`"'\r\n]+)[`"']/g, ' ')
        if (nativeChatImageFileReference(remaining.trim())) {
          add(remaining)
        } else {
          for (const match of remaining.matchAll(OUTPUT_PATH)) {
            add(match[0])
          }
        }
      }
    }
  }
  visit(output)
  return images
}
