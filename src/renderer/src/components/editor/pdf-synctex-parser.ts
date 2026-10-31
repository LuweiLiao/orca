import { resolveRuntimePath } from '../../../../shared/cross-platform-path'

/** A rectangle on a PDF page in PDF points, origin at the page's top-left, y growing down. */
export type SynctexRect = { page: number; left: number; top: number; width: number; height: number }

export type SynctexBox = SynctexRect & { tag: number; line: number }
/** A source position inside a line of text; `box` indexes its enclosing line box, or -1. */
export type SynctexPoint = {
  page: number
  x: number
  y: number
  tag: number
  line: number
  box: number
}

/** A parsed `.synctex(.gz)`: the line boxes TeX shipped and the source points inside them. */
export type SynctexData = {
  inputs: ReadonlyMap<number, string>
  boxes: readonly SynctexBox[]
  points: readonly SynctexPoint[]
}

// Why: SyncTeX stores TeX scaled points; 65781.76 sp make one PDF point (bp).
const SP_PER_BP = 65781.76
const NUMBER = /-?\d+/g

const OPEN_VBOX = 91 // [
const CLOSE_VBOX = 93 // ]
const OPEN_HBOX = 40 // (
const CLOSE_HBOX = 41 // )
const VOID_HBOX = 104 // h
const POINT_KINDS = new Set([120, 107, 103, 36]) // x k g $

function headerNumber(record: string, name: string): number | null {
  if (!record.startsWith(name)) {
    return null
  }
  const value = Number(record.slice(name.length))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Parses SyncTeX's text format. Only the records Orca navigates by are kept: horizontal boxes
 * (`(` and void `h`), which are lines of text, and the points inside them (`x k g $`), which
 * carry the precise source line; a box's own tag is often the paragraph's last line. Input paths
 * resolve against `synctexDir`. X/Y Offset headers are ignored: pdfTeX, XeTeX and LuaTeX write 0.
 */
export function parseSynctex(text: string, synctexDir: string): SynctexData {
  const inputs = new Map<number, string>()
  const boxes: SynctexBox[] = []
  const points: SynctexPoint[] = []
  let unit = 1
  let magnification = 1000
  let page = 0
  // Per open box, the index of the line box it is (-1 for vertical or unreadable boxes).
  const open: number[] = []
  // Per line box, the index of its first point until a second one is seen (then -1).
  const firstPointOfBox = new Map<number, number>()
  const misleading = new Set<number>()
  const bp = (value: number): number => (value * unit * magnification) / 1000 / SP_PER_BP
  for (const record of text.split('\n')) {
    const kind = record.charCodeAt(0)
    if (page === 0) {
      if (record.startsWith('Input:')) {
        const rest = record.slice('Input:'.length)
        const colon = rest.indexOf(':')
        const tag = Number(rest.slice(0, colon))
        if (colon > 0 && Number.isInteger(tag)) {
          inputs.set(tag, resolveRuntimePath(synctexDir, rest.slice(colon + 1).trim()))
        }
        continue
      }
      unit = headerNumber(record, 'Unit:') ?? unit
      magnification = headerNumber(record, 'Magnification:') ?? magnification
      if (kind === 123 /* { */) {
        page = Number(record.slice(1)) || 0
        open.length = 0
      }
      continue
    }
    if (kind === 125 /* } */) {
      page = 0
      continue
    }
    if (kind === CLOSE_HBOX || kind === CLOSE_VBOX) {
      open.pop()
      continue
    }
    if (kind === OPEN_VBOX) {
      open.push(-1)
      continue
    }
    const opensBox = kind === OPEN_HBOX
    if (!opensBox && kind !== VOID_HBOX && !POINT_KINDS.has(kind)) {
      continue
    }
    const colon = record.indexOf(':')
    const link = colon > 0 ? (record.slice(1, colon).match(NUMBER) ?? []).map(Number) : []
    const place = colon > 0 ? (record.slice(colon + 1).match(NUMBER) ?? []).map(Number) : []
    const [tag, line] = link
    const [h, v, width = 0, height = 0, depth = 0] = place
    if (tag === undefined || line === undefined || h === undefined || v === undefined) {
      // Keep the box stack balanced even when a record cannot be read.
      if (opensBox) {
        open.push(-1)
      }
      continue
    }
    if (opensBox || kind === VOID_HBOX) {
      boxes.push({
        page,
        tag,
        line,
        left: bp(h),
        top: bp(v - height),
        width: bp(width),
        height: bp(height + depth)
      })
      if (opensBox) {
        open.push(boxes.length - 1)
      }
      continue
    }
    const box = open.at(-1) ?? -1
    if (box >= 0) {
      const first = firstPointOfBox.get(box)
      if (first === undefined) {
        firstPointOfBox.set(box, points.length)
      } else if (first >= 0) {
        // Why: a paragraph line's leading point carries the paragraph's end line, not its own.
        if (points[first].line !== line) {
          misleading.add(first)
        }
        firstPointOfBox.set(box, -1)
      }
    }
    points.push({ page, x: bp(h), y: bp(v), tag, line, box })
  }
  return {
    inputs,
    boxes,
    points: misleading.size ? points.filter((_, index) => !misleading.has(index)) : points
  }
}
