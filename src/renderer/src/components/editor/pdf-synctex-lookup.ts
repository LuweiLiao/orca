import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import type { SynctexData, SynctexRect } from './pdf-synctex-parser'

export type SynctexSource = { file: string; line: number }

// Why: a point outside any line box still needs a visible mark one text line high.
const LONE_POINT_HEIGHT = 10
const LONE_POINT_WIDTH = 40

function tagsOf(data: SynctexData, file: string): Set<number> {
  const wanted = normalizeRuntimePathForComparison(file)
  const tags = new Set<number>()
  for (const [tag, path] of data.inputs) {
    if (normalizeRuntimePathForComparison(path) === wanted) {
      tags.add(tag)
    }
  }
  return tags
}

/** Whether the PDF was built from `file`, so a forward search can pick among open PDFs. */
export function synctexIncludesSource(data: SynctexData, file: string): boolean {
  return tagsOf(data, file).size > 0
}

/**
 * Where source `line` of `file` landed: the line boxes around its points on the first page it
 * reaches. A line without points (blank, comment) uses the nearest line that has some.
 */
export function synctexForward(data: SynctexData, file: string, line: number): SynctexRect | null {
  const tags = tagsOf(data, file)
  if (tags.size === 0) {
    return null
  }
  const sourcePoints = data.points.filter((point) => tags.has(point.tag))
  let target: number | null = null
  for (const point of sourcePoints) {
    const distance = Math.abs(point.line - line)
    const best = target === null ? Infinity : Math.abs(target - line)
    if (distance < best || (distance === best && target !== null && point.line < target)) {
      target = point.line
    }
  }
  if (target === null) {
    const box = data.boxes.find((candidate) => tags.has(candidate.tag) && candidate.line === line)
    return box ? { ...box } : null
  }
  const hits = sourcePoints.filter((point) => point.line === target)
  const page = Math.min(...hits.map((point) => point.page))
  let rect: { left: number; top: number; right: number; bottom: number } | null = null
  for (const point of hits) {
    if (point.page !== page) {
      continue
    }
    const box = point.box >= 0 ? data.boxes[point.box] : undefined
    const left = box && box.width > 0 ? box.left : point.x
    const right = box && box.width > 0 ? box.left + box.width : point.x + LONE_POINT_WIDTH
    const top = box && box.height > 0 ? box.top : point.y - LONE_POINT_HEIGHT
    const bottom = box && box.height > 0 ? box.top + box.height : point.y
    rect = rect
      ? {
          left: Math.min(rect.left, left),
          top: Math.min(rect.top, top),
          right: Math.max(rect.right, right),
          bottom: Math.max(rect.bottom, bottom)
        }
      : { left, top, right, bottom }
  }
  return rect
    ? {
        page,
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top
      }
    : null
}

/**
 * The source behind a spot on `page` (PDF points from the top-left): the word under it in the
 * smallest line box that holds it, else the nearest point on the page.
 */
export function synctexReverse(
  data: SynctexData,
  page: number,
  x: number,
  y: number
): SynctexSource | null {
  let boxIndex = -1
  let boxArea = Infinity
  data.boxes.forEach((box, index) => {
    const area = box.width * box.height
    if (
      box.page === page &&
      area > 0 &&
      area < boxArea &&
      x >= box.left &&
      x <= box.left + box.width &&
      y >= box.top &&
      y <= box.top + box.height
    ) {
      boxIndex = index
      boxArea = area
    }
  })
  let tag: number | null = null
  let line = 0
  if (boxIndex >= 0) {
    // Why the last point at or before x: a point marks where its word starts (left to right).
    const inside = data.points.filter((point) => point.box === boxIndex)
    const before = inside.filter((point) => point.x <= x)
    const word = before.length
      ? before.reduce((a, b) => (b.x >= a.x ? b : a))
      : inside.reduce<(typeof inside)[number] | null>((a, b) => (a && a.x <= b.x ? a : b), null)
    const box = data.boxes[boxIndex]
    tag = word?.tag ?? box.tag
    line = word?.line ?? box.line
  } else {
    let nearest = Infinity
    for (const point of data.points) {
      if (point.page !== page) {
        continue
      }
      // Why weight y: a click belongs to the text line it is on before a closer word above.
      const distance = Math.hypot(point.x - x, (point.y - y) * 3)
      if (distance < nearest) {
        nearest = distance
        tag = point.tag
        line = point.line
      }
    }
  }
  const file = tag === null ? undefined : data.inputs.get(tag)
  return file && line > 0 ? { file, line } : null
}
