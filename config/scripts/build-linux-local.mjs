#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const SUPPORTED_ARCHES = new Set(['x64', 'arm64'])
const LOCAL_BUILD_PATTERN = /^orca-ide_(\d+\.\d+\.\d+-llw(\d+))_(?:amd64|arm64)\.deb$/

export function nextLlwBuildVersion(baseVersion, artifactNames) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(baseVersion)
  if (!match) {
    throw new Error(`Unsupported LLW base version: ${baseVersion}`)
  }
  const localBase = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
  const last = artifactNames.reduce((largest, name) => {
    const found = LOCAL_BUILD_PATTERN.exec(name)
    return found?.[1].startsWith(`${localBase}-llw`) ? Math.max(largest, Number(found[2])) : largest
  }, 0)
  return `${localBase}-llw${last + 1}`
}

/** Select the local Linux package architecture without relying on builder defaults. */
export function resolveLinuxBuildArch({
  platform = process.platform,
  hostArch = process.arch,
  requestedArch = process.env.ORCA_LINUX_BUILD_ARCH
} = {}) {
  const arch = requestedArch ?? (platform === 'linux' ? hostArch : 'x64')
  if (!SUPPORTED_ARCHES.has(arch)) {
    throw new Error(
      `Unsupported Linux build architecture: ${arch}. Use ORCA_LINUX_BUILD_ARCH=x64|arm64.`
    )
  }
  return arch
}

export function buildLinuxElectronBuilderArgs(arch, extraArgs = []) {
  if (!SUPPORTED_ARCHES.has(arch)) {
    throw new Error(`Unsupported Linux build architecture: ${arch}`)
  }
  return [
    'exec',
    'electron-builder',
    '--config',
    'config/electron-builder.config.cjs',
    '--linux',
    'AppImage',
    'deb',
    'rpm',
    `--${arch}`,
    ...extraArgs
  ]
}

export function runLocalLinuxBuild({
  arch = resolveLinuxBuildArch(),
  extraArgs = [],
  environment = process.env,
  execFile = execFileSync,
  platform = process.platform,
  cwd = resolve(import.meta.dirname, '../..'),
  artifactNames = existsSync(resolve(cwd, 'dist')) ? readdirSync(resolve(cwd, 'dist')) : [],
  baseVersion = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')).version
} = {}) {
  const env = { ...environment }
  const localVersion = nextLlwBuildVersion(baseVersion, artifactNames)
  const buildNumber = /-llw(\d+)$/.exec(localVersion)?.[1]
  env.ORCA_LOCAL_BUILD_VERSION = localVersion
  env.ORCA_LLW_BUILD_NUMBER = buildNumber
  console.log(`[build:linux] local version ${localVersion}`)
  if (arch === 'arm64') {
    env.ORCA_LINUX_ARM64_RELEASE = '1'
  } else {
    delete env.ORCA_LINUX_ARM64_RELEASE
  }
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  execFile(pnpm, buildLinuxElectronBuilderArgs(arch, extraArgs), {
    cwd,
    env,
    stdio: 'inherit'
  })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  runLocalLinuxBuild({ extraArgs: process.argv.slice(2) })
}
