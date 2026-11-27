// Review notes put into a chat travel as one tagged block: the agent reads every note in it,
// while the chat folds the block into a single "N notes" pill that opens to show them.

const OPEN = '<orca-review-notes count="'
const CLOSE = '</orca-review-notes>'
const BLOCK = /<orca-review-notes count="(\d+)">\n([\s\S]*?)\n<\/orca-review-notes>/g

export type ReviewNotesBlock = { count: number; body: string }

export function reviewNotesBlockToken(block: ReviewNotesBlock): string {
  return `${OPEN}${block.count}">\n${block.body}\n${CLOSE}`
}

/** Text split around review-notes blocks, in order; plain text stays as strings. */
export function splitReviewNotesBlocks(text: string): (string | ReviewNotesBlock)[] {
  const parts: (string | ReviewNotesBlock)[] = []
  let offset = 0
  for (const match of text.matchAll(BLOCK)) {
    const count = Number(match[1])
    if (!Number.isSafeInteger(count) || count < 1) {
      continue
    }
    if (match.index > offset) {
      parts.push(text.slice(offset, match.index))
    }
    parts.push({ count, body: match[2]! })
    offset = match.index + match[0].length
  }
  if (offset < text.length) {
    parts.push(text.slice(offset))
  }
  return parts
}

/** One note's text per entry, in the order they were added. */
export function reviewNotesBlockEntries(block: ReviewNotesBlock): string[] {
  return block.body
    .split(/\n{2,}(?=File: )/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}
