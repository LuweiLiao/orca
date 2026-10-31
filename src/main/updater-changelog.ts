import { net } from 'electron'
import type { ChangelogData } from '../shared/update-status-types'
import { MAIN_RELEASE_REPO, getReleaseNotesUrlForVersion } from '../shared/release-channel'

export async function fetchChangelog(
  incomingVersion: string,
  _localVersion: string
): Promise<ChangelogData | null> {
  const tag = `v${incomingVersion.replace(/^v/i, '')}`
  const res = await net.fetch(
    `https://api.github.com/repos/${MAIN_RELEASE_REPO}/releases/tags/${encodeURIComponent(tag)}`,
    { signal: AbortSignal.timeout(5000) }
  )
  if (!res.ok) {
    return null
  }
  const entry: unknown = await res.json()
  if (!entry || typeof entry !== 'object' || !('body' in entry) || typeof entry.body !== 'string') {
    return null
  }
  return {
    release: {
      title: 'name' in entry && typeof entry.name === 'string' ? entry.name : tag,
      description: entry.body,
      releaseNotesUrl: getReleaseNotesUrlForVersion(incomingVersion)
    },
    releasesBehind: null
  }
}
