import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runProcess } from '@orca/process-host'
import { resolveExecutableCommand } from './node-cli-command-resolution'
import { loadGitGraphFromExecutor } from './git-graph'
import {
  GIT_GRAPH_CURSOR_EXPIRED_CODE,
  GIT_GRAPH_CURSOR_INVALID_CODE,
  GIT_GRAPH_NOT_A_REPOSITORY_CODE,
  GIT_GRAPH_REF_NOT_FOUND_CODE,
  GIT_GRAPH_SNAPSHOT_CHANGED_CODE
} from './git-graph-errors'
import { GIT_GRAPH_SNAPSHOT_TTL_MS, GitGraphSnapshotStore } from './git-graph-snapshot-store'
import {
  GIT_GRAPH_MAX_REFS_PER_NAMESPACE,
  type GitGraphExecutor,
  type GitGraphOptions,
  type GitGraphResult
} from './git-graph-types'

const roots: string[] = []
const gitBinary = resolveExecutableCommand(process.env.ORCA_TEST_GIT_BINARY ?? 'git')

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createSandbox() {
  if (!gitBinary) {
    throw new Error('Git is required for the real graph regression')
  }
  const root = await mkdtemp(join(tmpdir(), 'orca-graph-'))
  roots.push(root)
  const emptyConfig = join(root, 'empty-git-config')
  const emptyHooks = join(root, 'empty-hooks')
  await writeFile(emptyConfig, '')
  await mkdir(emptyHooks)
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))
    ),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CEILING_DIRECTORIES: root,
    LANGUAGE: 'en',
    LC_ALL: 'C'
  }
  let tick = 0
  const git: GitGraphExecutor = async (args, cwd, input) => {
    tick += 1
    // Why: distinct timestamps keep topo-order tie-breaks deterministic across runs.
    const date = new Date(Date.UTC(2001, 0, 1) + tick * 60_000).toISOString()
    const result = await runProcess({
      program: gitBinary,
      args,
      cwd,
      env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      ...(input?.stdin === undefined ? {} : { input: input.stdin }),
      timeoutMs: 20_000,
      maxOutputBytes: 8 * 1024 * 1024
    })
    if (result.code !== 0 || result.timedOut || result.outputTruncated) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    }
    return { stdout: result.stdout }
  }
  const init = async (name: string) => {
    const repo = join(root, name)
    await mkdir(repo)
    await git(['init', '--quiet'], repo)
    // Why not init -b: that flag is Git 2.28+, above the 2.25 baseline.
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repo)
    for (const [key, value] of [
      ['user.name', 'Graph Fixture'],
      ['user.email', 'graph-fixture@example.test'],
      ['commit.gpgsign', 'false'],
      ['core.hooksPath', emptyHooks]
    ]) {
      await git(['config', key, value], repo)
    }
    return repo
  }
  return { root, git, init }
}

type Sandbox = Awaited<ReturnType<typeof createSandbox>>

async function commit(sandbox: Sandbox, repo: string, subject: string): Promise<string> {
  await sandbox.git(['commit', '--quiet', '--allow-empty', '-m', subject], repo)
  return (await sandbox.git(['rev-parse', 'HEAD'], repo)).stdout.trim()
}

/**
 * main: A-B-C-M(merge of topic)-D, topic: B-T1 (merged), feature: B-F1-F2 (unmerged),
 * origin/side: A-R1 (remote-only), tags v1 (annotated, A) and dangling (orphan X only).
 */
async function createBranchyRepository(sandbox: Sandbox) {
  const repo = await sandbox.init('branchy')
  const ids: Record<string, string> = {}
  ids.A = await commit(sandbox, repo, 'A')
  await sandbox.git(['tag', '-a', 'v1', '-m', 'release v1'], repo)
  ids.B = await commit(sandbox, repo, 'B')
  await sandbox.git(['checkout', '--quiet', '-b', 'feature'], repo)
  ids.F1 = await commit(sandbox, repo, 'F1')
  ids.F2 = await commit(sandbox, repo, 'F2')
  await sandbox.git(['checkout', '--quiet', '-b', 'topic', ids.B], repo)
  ids.T1 = await commit(sandbox, repo, 'T1')
  await sandbox.git(['checkout', '--quiet', 'main'], repo)
  ids.C = await commit(sandbox, repo, 'C')
  await sandbox.git(['merge', '--quiet', '--no-ff', '-m', 'M', 'topic'], repo)
  ids.M = (await sandbox.git(['rev-parse', 'HEAD'], repo)).stdout.trim()
  ids.D = await commit(sandbox, repo, 'D')
  await sandbox.git(['checkout', '--quiet', '--detach', ids.A], repo)
  ids.R1 = await commit(sandbox, repo, 'R1')
  await sandbox.git(['checkout', '--quiet', '--orphan', 'scratch'], repo)
  ids.X = await commit(sandbox, repo, 'X')
  await sandbox.git(['tag', 'dangling'], repo)
  await sandbox.git(['checkout', '--quiet', 'main'], repo)
  await sandbox.git(['branch', '--quiet', '-D', 'scratch'], repo)
  await sandbox.git(['update-ref', 'refs/remotes/origin/side', ids.R1], repo)
  await sandbox.git(['update-ref', 'refs/remotes/origin/main', ids.C], repo)
  await sandbox.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], repo)
  return { repo, ids }
}

function graphReader(sandbox: Sandbox, repo: string, snapshots = new GitGraphSnapshotStore()) {
  return (options: GitGraphOptions, repositoryKey = repo) =>
    loadGitGraphFromExecutor(sandbox.git, repo, options, { repositoryKey, snapshots })
}

async function readAllPages(
  read: (options: GitGraphOptions) => Promise<GitGraphResult>,
  options: GitGraphOptions,
  betweenPages: (pageIndex: number) => Promise<void> = async () => {}
): Promise<GitGraphResult[]> {
  const pages = [await read(options)]
  while (pages.at(-1)?.nextCursor) {
    await betweenPages(pages.length)
    pages.push(await read({ ...options, cursor: pages.at(-1)?.nextCursor }))
  }
  return pages
}

describe('real Git graph scopes', () => {
  it('walks HEAD, local branches, or remote-tracking refs without walking tag-only history', async () => {
    const sandbox = await createSandbox()
    const { repo, ids } = await createBranchyRepository(sandbox)
    const read = graphReader(sandbox, repo)
    const subjects = async (scope: GitGraphOptions['scope']) =>
      new Set((await read({ scope, limit: 200 })).items.map((item) => item.subject))

    expect(await subjects('head')).toEqual(new Set(['D', 'M', 'T1', 'C', 'B', 'A']))
    expect(await subjects('local')).toEqual(new Set(['D', 'M', 'T1', 'C', 'F2', 'F1', 'B', 'A']))
    expect(await subjects('all')).toEqual(
      new Set(['D', 'M', 'T1', 'C', 'F2', 'F1', 'B', 'R1', 'A'])
    )

    const all = await read({ scope: 'all', limit: 200 })
    const byId = new Map(all.items.map((item) => [item.id, item]))
    expect(byId.get(ids.M)?.parentIds).toEqual([ids.C, ids.T1])
    expect(byId.get(ids.A)?.references?.map((ref) => ref.id)).toEqual(['refs/tags/v1'])
    expect(byId.get(ids.C)?.references?.map((ref) => ref.id)).toEqual(['refs/remotes/origin/main'])
    expect(all.refs.map((ref) => ref.id)).toContain('refs/tags/dangling')
    expect(all.refs.map((ref) => ref.id)).not.toContain('refs/remotes/origin/HEAD')
    expect(all.refs.find((ref) => ref.id === 'refs/tags/dangling')?.revision).toBe(ids.X)
    expect(all).toMatchObject({
      headOid: ids.D,
      currentRef: { id: 'refs/heads/main', category: 'branches' },
      scope: 'all',
      hasMore: false,
      truncated: false,
      isShallow: false
    })
  })

  it('keeps a detached commit and a selected ref in scope alongside HEAD', async () => {
    const sandbox = await createSandbox()
    const { repo, ids } = await createBranchyRepository(sandbox)
    await sandbox.git(['checkout', '--quiet', '--detach', ids.F1], repo)
    const detached = await commit(sandbox, repo, 'Detached')
    const read = graphReader(sandbox, repo)

    const local = await read({ scope: 'local', limit: 200 })
    expect(local.items[0]?.id).toBe(detached)
    expect(local.currentRef).toMatchObject({ id: detached, category: 'commits' })

    const selected = await read({ scope: 'ref', ref: 'origin/side', limit: 200 })
    expect(new Set(selected.items.map((item) => item.subject))).toEqual(
      new Set(['Detached', 'F1', 'B', 'R1', 'A'])
    )
    await expect(read({ scope: 'ref', ref: 'missing-branch' })).rejects.toThrow(
      GIT_GRAPH_REF_NOT_FOUND_CODE
    )
    await expect(read({ scope: 'ref', ref: '--output=/tmp/x' })).rejects.toThrow(
      GIT_GRAPH_REF_NOT_FOUND_CODE
    )
  })

  it('caps each ref namespace and reports the omission', async () => {
    const sandbox = await createSandbox()
    const repo = await sandbox.init('many-refs')
    const tip = await commit(sandbox, repo, 'only')
    const updates = Array.from(
      { length: GIT_GRAPH_MAX_REFS_PER_NAMESPACE + 5 },
      (_, index) => `create refs/heads/b${index} ${tip}\n`
    ).join('')
    await sandbox.git(['update-ref', '--stdin'], repo, { stdin: updates })

    const result = await graphReader(sandbox, repo)({ scope: 'local' })

    expect(result.truncated).toBe(true)
    expect(result.refs.filter((ref) => ref.category === 'branches')).toHaveLength(
      GIT_GRAPH_MAX_REFS_PER_NAMESPACE
    )
    expect(result.items.map((item) => item.id)).toEqual([tip])
  })
})

describe('real Git graph pagination', () => {
  it('pages a pinned snapshot without duplicates or loss while refs move', async () => {
    const sandbox = await createSandbox()
    const { repo, ids } = await createBranchyRepository(sandbox)
    const read = graphReader(sandbox, repo)
    const expected = (await read({ scope: 'all', limit: 200 })).items.map((item) => item.id)

    const pages = await readAllPages(read, { scope: 'all', limit: 2 }, async (pageIndex) => {
      if (pageIndex === 1) {
        await commit(sandbox, repo, 'After page one')
        await sandbox.git(['branch', '--quiet', '-D', 'feature'], repo)
        await sandbox.git(['update-ref', 'refs/remotes/origin/side', ids.B], repo)
      }
    })

    const paged = pages.flatMap((page) => page.items.map((item) => item.id))
    expect(paged).toEqual(expected)
    expect(pages.length).toBe(Math.ceil(expected.length / 2))
    expect(pages.slice(0, -1).every((page) => page.hasMore && page.nextCursor)).toBe(true)
    expect(pages.at(-1)?.hasMore).toBe(false)
    const f2 = pages.flatMap((page) => page.items).find((item) => item.id === ids.F2)
    expect(f2?.references?.map((ref) => ref.id)).toEqual(['refs/heads/feature'])
    expect(pages.every((page) => page.refs.some((ref) => ref.id === 'refs/heads/feature'))).toBe(
      true
    )
  })

  it('rejects malformed, cross-repository, rescoped, expired, and misaligned cursors', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const sandbox = await createSandbox()
    const { repo } = await createBranchyRepository(sandbox)
    const other = await sandbox.init('other')
    await commit(sandbox, other, 'O1')
    const snapshots = new GitGraphSnapshotStore()
    const read = graphReader(sandbox, repo, snapshots)
    const readOther = graphReader(sandbox, other, snapshots)
    const first = await read({ scope: 'local', limit: 2 })
    const cursor = first.nextCursor ?? ''

    await expect(read({ scope: 'local', cursor: 'not-a-cursor' })).rejects.toThrow(
      GIT_GRAPH_CURSOR_INVALID_CODE
    )
    await expect(readOther({ scope: 'local', cursor })).rejects.toThrow(
      GIT_GRAPH_CURSOR_INVALID_CODE
    )
    await expect(read({ scope: 'all', cursor })).rejects.toThrow(GIT_GRAPH_CURSOR_INVALID_CODE)
    const misaligned = cursor.replace(/[0-9a-f]{16}$/, '0'.repeat(16))
    await expect(read({ scope: 'local', cursor: misaligned })).rejects.toThrow(
      GIT_GRAPH_SNAPSHOT_CHANGED_CODE
    )
    const forged = cursor.replace(/^gg1\.[0-9a-f]{32}/, `gg1.${'a'.repeat(32)}`)
    await expect(read({ scope: 'local', cursor: forged })).rejects.toThrow(
      GIT_GRAPH_CURSOR_EXPIRED_CODE
    )

    expect((await read({ scope: 'local', limit: 2, cursor })).items).toHaveLength(2)
    vi.setSystemTime(Date.now() + GIT_GRAPH_SNAPSHOT_TTL_MS + 1)
    await expect(read({ scope: 'local', cursor })).rejects.toThrow(GIT_GRAPH_CURSOR_EXPIRED_CODE)
  })
})

describe('real Git graph repository states', () => {
  it('separates an empty repository from a directory that is not a repository', async () => {
    const sandbox = await createSandbox()
    const empty = await sandbox.init('empty')
    const plain = join(sandbox.root, 'plain')
    await mkdir(plain)

    expect(await graphReader(sandbox, empty)({ scope: 'all' })).toEqual({
      items: [],
      refs: [],
      scope: 'all',
      hasMore: false,
      truncated: false,
      isShallow: false
    })
    await expect(graphReader(sandbox, plain)({ scope: 'head' })).rejects.toThrow(
      GIT_GRAPH_NOT_A_REPOSITORY_CODE
    )
  })

  it('reports a shallow clone whose boundary commit has no parents', async () => {
    const sandbox = await createSandbox()
    const { repo, ids } = await createBranchyRepository(sandbox)
    const shallow = join(sandbox.root, 'shallow')
    await sandbox.git(
      ['clone', '--quiet', '--depth', '2', '--branch', 'main', pathToFileURL(repo).href, shallow],
      sandbox.root
    )

    const result = await graphReader(sandbox, shallow)({ scope: 'head', limit: 200 })

    expect(result.isShallow).toBe(true)
    expect(result.items[0]?.id).toBe(ids.D)
    expect(result.items.at(-1)?.parentIds).toEqual([])
  })
})
