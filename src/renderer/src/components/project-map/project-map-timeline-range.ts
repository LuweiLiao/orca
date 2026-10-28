/** The turns picked for a range reference, by the user messages that open its first and last. */
export type ProjectMapTimelineRange = { fromItemId: string; toItemId: string }

/**
 * Picking a turn starts a range, or stretches the one there is out to it; picking an end of a
 * range of several turns pulls that end in, and picking the only turn drops the range.
 */
export function pickProjectMapTimelineTurn(
  range: ProjectMapTimelineRange | null,
  itemId: string,
  order: readonly string[]
): ProjectMapTimelineRange | null {
  const at = order.indexOf(itemId)
  const bounds = range ? projectMapTimelineRangeBounds(range, order) : null
  if (at === -1 || !bounds) {
    return at === -1 ? range : { fromItemId: itemId, toItemId: itemId }
  }
  const [from, to] = bounds
  if (from === to && at === from) {
    return null
  }
  if (at === from) {
    return { fromItemId: order[from + 1]!, toItemId: order[to]! }
  }
  if (at === to) {
    return { fromItemId: order[from]!, toItemId: order[to - 1]! }
  }
  return at < from
    ? { fromItemId: itemId, toItemId: order[to]! }
    : at > to
      ? { fromItemId: order[from]!, toItemId: itemId }
      : range
}

/** The range's first and last turn as indexes into `order`, or null once either is gone. */
export function projectMapTimelineRangeBounds(
  range: ProjectMapTimelineRange,
  order: readonly string[]
): [number, number] | null {
  const from = order.indexOf(range.fromItemId)
  const to = order.indexOf(range.toItemId)
  return from === -1 || to === -1 || to < from ? null : [from, to]
}
