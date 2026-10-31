import type { RuntimeFileReadArgs } from '@/runtime/runtime-file-client-types'
import {
  readRuntimeFileRange,
  statRuntimeReadTarget,
  type RuntimeFileSnapshot
} from '@/runtime/runtime-file-range-client'

// Why: latexmk/pdflatex write the PDF in place over seconds and several passes; reading at the
// first watch event parses half a file. Wait until size+mtime hold still and the file ends.
export const PDF_SETTLE_QUIET_MS = 250
export const PDF_SETTLE_MAX_WAIT_MS = 8_000
const PDF_TAIL_BYTES = 1024

export type PdfSettleProbe = {
  stat: () => Promise<Pick<RuntimeFileSnapshot, 'size' | 'mtime'>>
  /** Whether the file's last bytes close a PDF (`%%EOF`); null when the host cannot say. */
  endsComplete: (size: number) => Promise<boolean | null>
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** A newer load superseded this one; stop waiting. */
  cancelled: () => boolean
}

/** Resolves once the PDF looks fully written, or when waiting longer would not help. */
export async function waitForPdfToSettle(probe: PdfSettleProbe): Promise<void> {
  const deadline = probe.now() + PDF_SETTLE_MAX_WAIT_MS
  let previous: { size: number; mtime: number } | null = null
  while (!probe.cancelled() && probe.now() < deadline) {
    let current: { size: number; mtime: number }
    try {
      current = await probe.stat()
    } catch {
      return
    }
    if (
      previous !== null &&
      previous.size === current.size &&
      previous.mtime === current.mtime &&
      current.size > 0 &&
      (await probe.endsComplete(current.size)) !== false
    ) {
      return
    }
    previous = current
    await probe.sleep(PDF_SETTLE_QUIET_MS)
  }
}

export function pdfSettleProbe(
  args: RuntimeFileReadArgs,
  cancelled: () => boolean
): PdfSettleProbe {
  return {
    stat: () => statRuntimeReadTarget(args),
    endsComplete: async (size) => {
      const length = Math.min(size, PDF_TAIL_BYTES)
      try {
        const tail = await readRuntimeFileRange(args, size - length, length)
        return new TextDecoder('latin1').decode(tail).includes('%%EOF')
      } catch {
        return null
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    cancelled
  }
}

export function isPdfPath(filePath: string): boolean {
  return /\.pdf$/i.test(filePath)
}
