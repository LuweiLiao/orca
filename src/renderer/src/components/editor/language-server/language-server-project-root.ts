import { dirname, joinPath } from '@/lib/path'
import { relativePathInsideRoot } from '../../../../../shared/cross-platform-path'
import type { LanguageServerId } from '../../../../../shared/language-server-types'

/** Files that mark a project root a server must start in, for servers that do not search. */
const PROJECT_MARKERS: Partial<Record<LanguageServerId, readonly string[]>> = {
  // Why: rust-analyzer only finds a Cargo.toml in the root or one level down, so a crate deeper
  // in a monorepo (native/windows-agent-hook) opens as a detached file with no analysis.
  'rust-analyzer': ['Cargo.toml']
}

const cache = new Map<string, Promise<string>>()

async function hasMarker(dir: string, markers: readonly string[]): Promise<boolean> {
  for (const marker of markers) {
    if (await window.api.fs.pathExists({ filePath: joinPath(dir, marker) }).catch(() => false)) {
      return true
    }
  }
  return false
}

/**
 * The directory `serverId` should start in for `filePath`: the nearest ancestor holding a
 * project marker, never above `workspaceRoot`; the workspace root itself otherwise.
 */
export function languageServerProjectRoot(
  serverId: LanguageServerId,
  workspaceRoot: string,
  filePath: string
): Promise<string> {
  const markers = PROJECT_MARKERS[serverId]
  if (!markers) {
    return Promise.resolve(workspaceRoot)
  }
  const start = dirname(filePath)
  const key = `${serverId}\0${workspaceRoot}\0${start}`
  let found = cache.get(key)
  if (!found) {
    found = (async () => {
      for (
        let dir = start;
        relativePathInsideRoot(workspaceRoot, dir) !== null;
        dir = dirname(dir)
      ) {
        if (await hasMarker(dir, markers)) {
          return dir
        }
        if (relativePathInsideRoot(workspaceRoot, dir) === '' || dirname(dir) === dir) {
          break
        }
      }
      return workspaceRoot
    })()
    cache.set(key, found)
  }
  return found
}
