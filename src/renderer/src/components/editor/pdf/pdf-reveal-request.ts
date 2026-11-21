import type { SynctexRect } from './pdf-synctex-parser'

export const PDF_REVEAL_EVENT = 'orca:pdf-reveal'
// Why: a reveal whose PDF never mounts (closed meanwhile) must not fire on a later open.
const PENDING_REVEAL_TTL_MS = 10_000
const pendingReveals = new Map<string, { rect: SynctexRect; expiresAt: number }>()

/** The reveal waiting for PDF tab `fileId`, consumed once its viewer can show it. */
export function takePendingPdfReveal(fileId: string): SynctexRect | null {
  const pending = pendingReveals.get(fileId)
  pendingReveals.delete(fileId)
  return pending && pending.expiresAt > Date.now() ? pending.rect : null
}

/** Marks `rect` in PDF tab `fileId` once its viewer is showing, now or when it mounts. */
export function requestPdfReveal(fileId: string, rect: SynctexRect): void {
  pendingReveals.set(fileId, { rect, expiresAt: Date.now() + PENDING_REVEAL_TTL_MS })
  window.dispatchEvent(new CustomEvent(PDF_REVEAL_EVENT, { detail: { fileId } }))
}
