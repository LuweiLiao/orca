/** Cheap check before any reading: a request has a count. */
export const AGENT_DELEGATION_COUNT_HINT =
  /[0-9一二两三四五六七八九十俩仨]|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i
/** Where a count may start, for finding counts no request read. */
export const AGENT_DELEGATION_COUNT_START =
  /(?<![0-9a-z._-])(?:[0-9]{1,2}(?![0-9])|(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)|[一二两三四五六七八九十俩仨]/gi

// "2", "2x", "两个", "十二名", "two"; a CJK numeral needs its measure word, so "一下" is no count.
const COUNT =
  /^(?:([0-9]{1,2})(?![0-9.])\s*(?:[x×](?![a-z0-9]))?|([一二两三四五六七八九十俩仨]{1,3})(?=[个只名位台路组套])|(one|two|three|four|five|six|seven|eight|nine|ten)\b)\s*(?:[个只名位台路组套])?\s*/i
const CJK_DIGITS: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  两: 2,
  俩: 2,
  三: 3,
  仨: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}
const ENGLISH_COUNTS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten'
]

/** The count at the start of `rest` (1–99) and the characters it and its measure word cover. */
export function agentDelegationCountAt(rest: string): { count: number; length: number } | null {
  const match = rest.match(COUNT)
  if (!match) {
    return null
  }
  const [whole, digits, cjk, english] = match
  const count = digits
    ? Number(digits)
    : cjk
      ? cjkCount(cjk)
      : ENGLISH_COUNTS.indexOf((english ?? '').toLowerCase()) + 1
  return count >= 1 && count <= 99 ? { count, length: whole.length } : null
}

function cjkCount(numeral: string): number {
  const [tensText = '', onesText, extra] = numeral.split('十')
  if (extra !== undefined) {
    return 0
  }
  if (onesText === undefined) {
    return numeral.length === 1 ? (CJK_DIGITS[numeral] ?? 0) : 0
  }
  const tens = tensText === '' ? 1 : tensText.length === 1 ? (CJK_DIGITS[tensText] ?? 0) : 0
  const ones =
    onesText === '' ? 0 : onesText.length === 1 ? (CJK_DIGITS[onesText] ?? Number.NaN) : Number.NaN
  return tens * 10 + ones
}
