/** The map node an event happened on, by its `data-project-map-node` id. */
export function projectMapNodeIdOf(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest('[data-project-map-node]')?.getAttribute('data-project-map-node') ?? null)
    : null
}
