import { IMAGE_FILE_EXTENSIONS } from './image-file-extensions'
import { routeNativeChatHref } from './native-chat-href-routing'
import type { NativeChatImageRefBlock } from './native-chat-types'

const IMAGE_SUFFIX = new RegExp(
  `\\.(?:${IMAGE_FILE_EXTENSIONS.map((extension) => extension.slice(1)).join('|')})$`,
  'i'
)
const IMAGE_OUTPUT_FIELDS = new Set([
  'path',
  'file_path',
  'filePath',
  'imagePath',
  'image_path',
  'url',
  'image',
  'images',
  'files',
  'screenshot',
  'screenshots',
  'content',
  'text',
  'result',
  'output',
  'data'
])

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
    const candidate = value.trim().replace(/^([`"'])(.*)\1[.,;]?$/, '$2')
    const image = nativeChatImageFileReference(candidate)
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
      for (const [key, entry] of fields) {
        if (IMAGE_OUTPUT_FIELDS.has(key)) {
          visit(entry)
        }
      }
    } else if (typeof value === 'string') {
      try {
        visit(JSON.parse(value))
        return
      } catch {
        // CLI stdout and MCP text blocks can report paths without JSON.
      }
      for (const line of value.split(/\r?\n/)) {
        const reported = line.match(
          /^\s*(?:saved|wrote|written|created|generated|rendered|output|image|screenshot|path)\b[^:]*:\s*(.+)$/i
        )
        add(reported?.[1] ?? line)
      }
    }
  }
  visit(output)
  return images
}
