import { accessSync, constants, statSync } from 'node:fs'

export const AGENT_SUDO_ENDPOINT_ENV = 'ORCA_SUDO_ASKPASS_ENDPOINT'
export const AGENT_SUDO_ASKPASS_PATHNAME = '/sudo-askpass'

// Why: NixOS has only the setuid wrapper; the others cover distro, BSD-style and Homebrew installs.
const REAL_SUDO_CANDIDATES = [
  '/run/wrappers/bin/sudo',
  '/usr/bin/sudo',
  '/bin/sudo',
  '/usr/local/bin/sudo'
] as const

export function resolveRealSudoPath(
  candidates: readonly string[] = REAL_SUDO_CANDIDATES
): string | null {
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) {
        continue
      }
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not installed at this location.
    }
  }
  return null
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** sudo runs this as the invoking user; its stdout line becomes the password. */
export function renderAgentSudoAskpassScript(): string {
  return [
    '#!/bin/sh',
    '# Orca sudo askpass: the running Orca supplies or confirms the password.',
    `endpoint=\${${AGENT_SUDO_ENDPOINT_ENV}:-}`,
    '[ -n "$endpoint" ] && [ -r "$endpoint" ] || exit 1',
    'command -v curl >/dev/null 2>&1 || exit 1',
    'IFS=" " read -r port token < "$endpoint" || exit 1',
    'case $port in "" | *[!0-9]*) exit 1 ;; esac',
    '[ -n "$token" ] || exit 1',
    'encode() { head -c "$1" | base64 | tr -d "\\n"; }',
    // sudo is the askpass parent, so its argv names the command being authorized.
    'sudo_pid=$PPID',
    'command_line=$(ps -o args= -p "$sudo_pid" 2>/dev/null | encode 2000)',
    'cwd=$(pwd 2>/dev/null | encode 1000)',
    'prompt=$(printf "%s" "${1:-}" | encode 500)',
    // Why stdin config: a token in argv is visible to every local user through ps.
    'printf \'header = "X-Orca-Sudo-Token: %s"\\n\' "$token" |',
    '  curl -s -f -K - --noproxy 127.0.0.1 --connect-timeout 2 --max-time 150 \\',
    '    -H "X-Orca-Sudo-Pid: $sudo_pid" \\',
    '    -H "X-Orca-Sudo-Command: $command_line" \\',
    '    -H "X-Orca-Sudo-Cwd: $cwd" \\',
    '    -H "X-Orca-Sudo-Prompt: $prompt" \\',
    `    --data '' "http://127.0.0.1:$port${AGENT_SUDO_ASKPASS_PATHNAME}"`,
    ''
  ].join('\n')
}

/** Adds -A so a terminal without a tty reaches Orca instead of hanging on a password prompt. */
export function renderAgentSudoShimScript(realSudoPath: string): string {
  return [
    '#!/bin/sh',
    '# Orca sudo shim: routes password prompts to Orca when its askpass is available.',
    `real_sudo=${shellSingleQuote(realSudoPath)}`,
    // A missing endpoint (password cleared or rejected) restores sudo's own prompt.
    `if [ -n "\${SUDO_ASKPASS:-}" ] && [ -x "$SUDO_ASKPASS" ] && [ -r "\${${AGENT_SUDO_ENDPOINT_ENV}:-/nonexistent}" ]; then`,
    '  add_askpass=1',
    '  skip_next=0',
    '  for arg in "$@"; do',
    '    if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi',
    '    case $arg in',
    '      --) break ;;',
    // sudo rejects -A together with -S; an explicit -A needs no second copy.
    '      --stdin | --askpass) add_askpass=0; break ;;',
    '      --user | --group | --prompt | --role | --type | --other-user | --close-from | --chdir | --chroot | --command-timeout) skip_next=1 ;;',
    '      --*) ;;',
    '      -?*)',
    '        flags=${arg#-}',
    '        while [ -n "$flags" ]; do',
    '          flag=${flags%"${flags#?}"}',
    '          flags=${flags#?}',
    '          case $flag in',
    '            S | A) add_askpass=0; break 2 ;;',
    '            [CDgpRrTtUu]) [ -z "$flags" ] && skip_next=1; break ;;',
    '          esac',
    '        done',
    '        ;;',
    '      *) break ;;',
    '    esac',
    '  done',
    '  if [ "$add_askpass" = 1 ]; then exec "$real_sudo" -A "$@"; fi',
    'fi',
    'exec "$real_sudo" "$@"',
    ''
  ].join('\n')
}
