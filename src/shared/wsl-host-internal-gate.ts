/** Windows exposes WSL hosts; the launch override also supports isolated tests and an opt-out. */
export const WSL_HOSTS_INTERNAL_GATE_ENV = 'ORCA_INTERNAL_WSL_HOSTS'

export function isWslHostsInternalGateOpen(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform
): boolean {
  const override = env[WSL_HOSTS_INTERNAL_GATE_ENV]
  return override === '1' || (platform === 'win32' && override !== '0')
}
