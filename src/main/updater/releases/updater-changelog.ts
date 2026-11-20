import { net } from 'electron'
import type { ChangelogData } from '../../../shared/updater/update-status-types'
import {
  MAIN_RELEASE_REPO,
  getReleaseNotesUrlForVersion
} from '../../../shared/updater/release-channel'

// LLW releases have no onorca.dev changelog; the update card shows the GitHub release notes.
// Electron net.fetch honors app proxy/certificate settings and avoids renderer CORS.
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
    await res.body?.cancel()
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
