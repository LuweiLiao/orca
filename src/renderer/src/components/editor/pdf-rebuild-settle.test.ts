import { describe, expect, it } from 'vitest'
import {
  PDF_SETTLE_MAX_WAIT_MS,
  PDF_SETTLE_QUIET_MS,
  waitForPdfToSettle,
  type PdfSettleProbe
} from './pdf-rebuild-settle'

type Disk = { size: number; mtime: number; complete: boolean | null }

/** A file that takes the given states in turn, one per quiet interval. */
function probeOver(states: Disk[], cancelAfterStats = Infinity) {
  let clock = 0
  let stats = 0
  const current = (): Disk =>
    states[Math.min(Math.floor(clock / PDF_SETTLE_QUIET_MS), states.length - 1)]
  const probe: PdfSettleProbe = {
    stat: async () => {
      stats += 1
      return current()
    },
    endsComplete: async () => current().complete,
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    cancelled: () => stats >= cancelAfterStats
  }
  return { probe, elapsed: () => clock, stats: () => stats }
}

describe('waitForPdfToSettle', () => {
  it('waits while the file grows and resolves once it holds still and ends', async () => {
    const writing = { complete: false }
    const disk = probeOver([
      { size: 0, mtime: 1, ...writing },
      { size: 4000, mtime: 2, ...writing },
      { size: 9000, mtime: 3, ...writing },
      { size: 9000, mtime: 3, complete: true }
    ])
    await waitForPdfToSettle(disk.probe)
    expect(disk.elapsed()).toBe(3 * PDF_SETTLE_QUIET_MS)
  })

  it('keeps waiting on a stalled half-written file, then gives up at the cap', async () => {
    const disk = probeOver([{ size: 5000, mtime: 7, complete: false }])
    await waitForPdfToSettle(disk.probe)
    expect(disk.elapsed()).toBeGreaterThanOrEqual(PDF_SETTLE_MAX_WAIT_MS)
    expect(disk.elapsed()).toBeLessThan(PDF_SETTLE_MAX_WAIT_MS + PDF_SETTLE_QUIET_MS * 2)
  })

  it('trusts a still file when the host cannot read its tail, and stops when superseded', async () => {
    const unknownTail = probeOver([{ size: 5000, mtime: 7, complete: null }])
    await waitForPdfToSettle(unknownTail.probe)
    expect(unknownTail.elapsed()).toBe(PDF_SETTLE_QUIET_MS)

    const superseded = probeOver([{ size: 5000, mtime: 7, complete: false }], 2)
    await waitForPdfToSettle(superseded.probe)
    expect(superseded.stats()).toBe(2)
  })
})
