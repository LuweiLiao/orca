import { fingerprintCodex, probeCodexVersion } from '../trust/hooks/codex-binary-version'

export type CodexClientInfo = { name: string; title: string; version: string }

// Codex turns clientInfo into the User-Agent prefix and originator; relays that allow only
// Codex CLI user agents reject `orca_desktop`, so report what the terminal Codex TUI reports.
const CODEX_CLIENT_NAME = 'codex-tui'
const FALLBACK_VERSION = '0.0.0'
// The version only labels the User-Agent; a slow first-run probe must not hold a launch.
const VERSION_WAIT_MS = 3_000

const probes = new Map<string, Promise<void>>()
const versions = new Map<string, string>()
let latestVersion: string | undefined

function versionKey(command: string): string {
  return fingerprintCodex(command) ?? command
}

/** Probe once per binary so later handshakes can report the real CLI version. */
export async function warmCodexClientVersion(command: string): Promise<void> {
  const key = versionKey(command)
  let probe = probes.get(key)
  if (!probe) {
    probe = probeCodexVersion(command)
      .then((output) => {
        const version = /^codex-cli\s+(\S+)/.exec(output ?? '')?.[1]
        if (version) {
          versions.set(key, version)
          latestVersion = version
        }
      })
      .catch(() => {})
    probes.set(key, probe)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, VERSION_WAIT_MS)
  })
  try {
    await Promise.race([probe, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Without a command (callers that only hold stdin), report the last probed version. */
export function codexClientInfo(command?: string): CodexClientInfo {
  const known = command === undefined ? latestVersion : versions.get(versionKey(command))
  const version = known ?? FALLBACK_VERSION
  return { name: CODEX_CLIENT_NAME, title: 'Orca', version }
}
