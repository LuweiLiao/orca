// Rewrites the TeX delimiters agents write — `\(…\)`, `\[…\]` and `$…$` — into the `$$` that
// remark-math reads with single-dollar math off. A lone `$` becomes math only when it reads as
// math, so prices (`$5 and $10`) and shell variables (`$HOME/$USER`) stay text. Code is untouched.

/** A character that glues a `$` to a word or number, so it is a price or a variable. */
const WORD_CHARACTER = /[A-Za-z0-9_]/
const FENCE_OPEN = /^([ \t]*(?:>[ \t]?)*(?:[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+)*)(`{3,}|~{3,})/
// What may stand before `\[` for it to open a line of its own: indent, quote and list markers.
const LINE_PREFIX = /^[ \t]*(?:>[ \t]?)*(?:[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+)*$/

export function normalizeMarkdownMathDelimiters(source: string): string {
  if (!source.includes('$') && !source.includes('\\(') && !source.includes('\\[')) {
    return source
  }
  let out = ''
  let index = 0
  while (index < source.length) {
    const lineStart = index === 0 || source[index - 1] === '\n'
    if (lineStart) {
      const fenceEnd = fencedCodeEnd(source, index)
      if (fenceEnd !== null) {
        out += source.slice(index, fenceEnd)
        index = fenceEnd
        continue
      }
    }
    const char = source[index]!
    if (char === '`') {
      const end = codeSpanEnd(source, index)
      out += source.slice(index, end)
      index = end
    } else if (char === '\\') {
      const next = source[index + 1]
      const math =
        next === '(' ? parenMath(source, index) : next === '[' ? bracketMath(source, index) : null
      if (math) {
        out += math.text
        index = math.end
      } else {
        // An escape keeps its character literal: `\$` is a dollar sign, never a delimiter.
        out += source.slice(index, index + 2)
        index += 2
      }
    } else if (char === '[' || (char === '!' && source[index + 1] === '[')) {
      const end = inlineLinkEnd(source, char === '!' ? index + 1 : index)
      const stop = end ?? index + 1
      out += source.slice(index, stop)
      index = stop
    } else if (char === '$') {
      const math = dollarMath(source, index)
      out += math.text
      index = math.end
    } else {
      out += char
      index += 1
    }
  }
  return out
}

/** Where a fenced code block opening on this line ends; it runs to the end when unclosed. */
function fencedCodeEnd(source: string, start: number): number | null {
  const line = lineAt(source, start)
  const open = FENCE_OPEN.exec(line.text)
  if (!open) {
    return null
  }
  const marker = open[2]!
  // A backtick fence's info string may not hold a backtick.
  if (marker[0] === '`' && line.text.slice(open[0].length).includes('`')) {
    return null
  }
  const close = new RegExp(`^[ \\t>]*${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`)
  let cursor = line.end
  while (cursor < source.length) {
    const next = lineAt(source, cursor)
    if (close.test(next.text)) {
      return next.end
    }
    cursor = next.end
  }
  return source.length
}

function lineAt(source: string, start: number): { text: string; end: number } {
  const newline = source.indexOf('\n', start)
  const end = newline === -1 ? source.length : newline + 1
  return { text: source.slice(start, newline === -1 ? end : newline).replace(/\r$/, ''), end }
}

/** The end of a code span, or just past its backticks when nothing closes them. */
function codeSpanEnd(source: string, start: number): number {
  let run = start
  while (source[run] === '`') {
    run += 1
  }
  const size = run - start
  let cursor = run
  while (cursor < source.length) {
    if (source[cursor] === '`') {
      let close = cursor
      while (source[close] === '`') {
        close += 1
      }
      if (close - cursor === size) {
        return close
      }
      cursor = close
    } else if (blankLineAt(source, cursor)) {
      break
    } else {
      cursor += 1
    }
  }
  return run
}

/** Whether a paragraph ends at this newline, which no inline construct crosses. */
function blankLineAt(source: string, index: number): boolean {
  return source[index] === '\n' && /^\n[ \t]*(?:\r?\n|$)/.test(source.slice(index, index + 64))
}

/** The end of `[text](destination)`, kept as written so its text and target stay as they are. */
function inlineLinkEnd(source: string, open: number): number | null {
  const textEnd = matchingClose(source, open, '[', ']')
  if (textEnd === null || source[textEnd] !== '(') {
    return null
  }
  return matchingClose(source, textEnd, '(', ')')
}

/** Just past the bracket closing the one at `open`, skipping escapes, within the paragraph. */
function matchingClose(
  source: string,
  open: number,
  opener: string,
  closer: string
): number | null {
  let depth = 0
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (char === '\\') {
      cursor += 1
    } else if (char === opener) {
      depth += 1
    } else if (char === closer) {
      depth -= 1
      if (depth === 0) {
        return cursor + 1
      }
    } else if (blankLineAt(source, cursor)) {
      return null
    }
  }
  return null
}

type MathRewrite = { text: string; end: number }

/** `\(…\)` within a paragraph is text math. */
function parenMath(source: string, start: number): MathRewrite | null {
  const close = closingSequence(source, start + 2, '\\)')
  const body = close === null ? '' : source.slice(start + 2, close).trim()
  return close === null || body === '' ? null : { text: `$$${body}$$`, end: close + 2 }
}

/** `\[…\]` is display math when it stands on lines of its own, else text math. */
function bracketMath(source: string, start: number): MathRewrite | null {
  const close = closingSequence(source, start + 2, '\\]')
  const body = close === null ? '' : source.slice(start + 2, close)
  if (close === null || body.trim() === '') {
    return null
  }
  const prefix = linePrefix(source, start)
  if (prefix === null || lineAt(source, close + 2).text.trim() !== '') {
    return { text: `$$${body.trim()}$$`, end: close + 2 }
  }
  // Lines added after the first keep the quote markers and the indent of the list item it opens.
  const continuation = prefix.replace(
    /(?:[-+*]|\d{1,9}[.)])([ \t]+)$/,
    (marker, space: string) => ' '.repeat(marker.length - space.length) + space
  )
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''))
  const kept = lines.flatMap((line, index) => {
    if (index === 0) {
      return line.trim() === '' ? [] : [continuation + line.trim()]
    }
    // The line `\]` closes on may hold only its quote markers.
    return index === lines.length - 1 && line.replace(/[ \t>]/g, '') === '' ? [] : [line]
  })
  return { text: `$$\n${kept.join('\n')}\n${continuation}$$`, end: close + 2 }
}

/** What stands before `index` on its line, when that is only indent, quote and list markers. */
function linePrefix(source: string, index: number): string | null {
  const prefix = source.slice(source.lastIndexOf('\n', index - 1) + 1, index)
  return LINE_PREFIX.test(prefix) ? prefix : null
}

/** The next unescaped `sequence`, within the paragraph unless display math may cross it. */
function closingSequence(
  source: string,
  from: number,
  sequence: string,
  crossesBlankLines = false
): number | null {
  for (let cursor = from; cursor < source.length; cursor += 1) {
    if (source.startsWith(sequence, cursor)) {
      return cursor
    }
    if (source[cursor] === '\\') {
      cursor += 1
    } else if (!crossesBlankLines && blankLineAt(source, cursor)) {
      return null
    }
  }
  return null
}

/** `$$…$$` stays math; `$…$` becomes math only under the pandoc rule, tightened for words. */
function dollarMath(source: string, start: number): MathRewrite {
  let run = start
  while (source[run] === '$') {
    run += 1
  }
  if (run - start >= 2) {
    const close = closingSequence(
      source,
      run,
      source.slice(start, run),
      linePrefix(source, start) !== null
    )
    // Why: an unclosed `$$` would open display math that swallows the rest of the message.
    return close === null
      ? { text: '\\$'.repeat(run - start), end: run }
      : { text: source.slice(start, close + run - start), end: close + run - start }
  }
  const before = source[start - 1] ?? ''
  const first = source[start + 1] ?? ''
  if (WORD_CHARACTER.test(before) || first === '' || /\s/.test(first)) {
    return { text: '$', end: start + 1 }
  }
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (char === '\n') {
      break
    }
    if (char === '\\') {
      cursor += 1
      continue
    }
    if (char !== '$') {
      continue
    }
    const after = source[cursor + 1] ?? ''
    // The first `$` decides: a price's `$` must not pair with a later formula's.
    if (/\s/.test(source[cursor - 1]!) || after === '$' || WORD_CHARACTER.test(after)) {
      break
    }
    return { text: `$$${source.slice(start + 1, cursor)}$$`, end: cursor + 1 }
  }
  return { text: '$', end: start + 1 }
}
