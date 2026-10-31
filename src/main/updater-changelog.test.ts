import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn<typeof fetch>()
vi.mock('electron', () => ({
  net: { fetch: (...args: Parameters<typeof fetch>) => fetchMock(...args) }
}))
import { fetchChangelog } from './updater-changelog'

describe('LLW release notes', () => {
  beforeEach(() => fetchMock.mockReset())

  it('reads the matching release from the fork', async () => {
    fetchMock.mockResolvedValue(Response.json({ name: 'LLW update', body: 'Background updates' }))
    expect(await fetchChangelog('1.4.215-llw.20261031.3', '1.4.215-llw.20261031.2')).toEqual({
      release: {
        title: 'LLW update',
        description: 'Background updates',
        releaseNotesUrl: 'https://github.com/LuweiLiao/orca/releases/tag/v1.4.215-llw.20261031.3'
      },
      releasesBehind: null
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/LuweiLiao/orca/releases/tags/v1.4.215-llw.20261031.3'
    )
  })

  it('keeps an update usable when release notes are unavailable', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    expect(await fetchChangelog('1.4.215', '1.4.214')).toBeNull()
  })
})
