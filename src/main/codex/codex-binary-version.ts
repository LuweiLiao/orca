import { realpathSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { withCliRuntimeOnPath } from '../codex-cli/command'

// Allow macOS first-run assessment, measured at 10–12s, off the launch path.
const VERSION_TIMEOUT_MS = 30_000
export const CODEX_VERSION_SCRATCH_PREFIX = 'orca-codex-version-'

// Detect binary replacement by updates/reinstalls, including equal-size atomic replacements via inode.
export function fingerprintCodex(codexPath: string): string | null {
  try {
    const realPath = realpathSync(codexPath)
    const info = statSync(realPath)
    return `${realPath}:${info.size}:${info.mtimeMs}:${info.ino}`
  } catch {
    return null
  }
}

export async function probeCodexVersion(codexCommand: string): Promise<string | null> {
  // Even --version creates tmp/arg0 in CODEX_HOME; isolate it from real homes.
  const scratchHome = await mkdtemp(join(tmpdir(), CODEX_VERSION_SCRATCH_PREFIX))
  try {
    const result = await runProcess({
      program: codexCommand,
      args: ['--version'],
      env: withCliRuntimeOnPath(codexCommand, { ...process.env, CODEX_HOME: scratchHome }),
      timeoutMs: VERSION_TIMEOUT_MS,
      // A hung Windows wrapper's Codex child would survive a root-only kill.
      terminationBarrier: true
    })
    return (result.code === 0 && result.stdout.trim()) || null
  } finally {
    await rm(scratchHome, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}
