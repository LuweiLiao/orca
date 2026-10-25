import { resolveCommit, resolveCurrentRef, resolveNamedRef } from './git-history'
import {
  compareGitHistoryItemRefsByCategory,
  gitHistoryRefFromFullName
} from './git-history-log-parser'
import type { GitHistoryItemRef } from './git-history-types'
import { GIT_GRAPH_NOT_A_REPOSITORY_CODE, GIT_GRAPH_REF_NOT_FOUND_CODE } from './git-graph-errors'
import type { GitGraphSnapshot } from './git-graph-snapshot-store'
import {
  GIT_GRAPH_MAX_REFS_PER_NAMESPACE,
  type GitGraphExecutor,
  type GitGraphScope
} from './git-graph-types'

const REF_RECORD_FORMAT =
  '--format=%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(refname)'

type RefListing = { refs: GitHistoryItemRef[]; truncated: boolean }

export function gitGraphErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error)
  }
  const stderr = 'stderr' in error ? String(error.stderr ?? '') : ''
  const message = error instanceof Error ? error.message : ''
  return `${stderr}\n${message}`
}

async function probeShallowRepository(git: GitGraphExecutor, cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(['rev-parse', '--is-shallow-repository'], cwd)
    return stdout.trim() === 'true'
  } catch (error) {
    if (/not a git repository/i.test(gitGraphErrorText(error))) {
      throw new Error(GIT_GRAPH_NOT_A_REPOSITORY_CODE)
    }
    throw error
  }
}

function peeledCommitOid(
  objectName: string,
  objectType: string,
  peeledName: string,
  peeledType: string
): string | null {
  if (objectType === 'commit') {
    return objectName
  }
  return objectType === 'tag' && peeledType === 'commit' ? peeledName : null
}

async function listNamespaceRefs(
  git: GitGraphExecutor,
  cwd: string,
  namespace: 'refs/heads' | 'refs/remotes' | 'refs/tags'
): Promise<RefListing> {
  // Why --count: a repository with thousands of refs must not ship them all; newest win.
  const { stdout } = await git(
    [
      'for-each-ref',
      '--sort=-creatordate',
      `--count=${GIT_GRAPH_MAX_REFS_PER_NAMESPACE + 1}`,
      REF_RECORD_FORMAT,
      namespace
    ],
    cwd
  )
  const records = stdout.split('\n').filter((line) => line.length > 0)
  const refs: GitHistoryItemRef[] = []
  for (const record of records.slice(0, GIT_GRAPH_MAX_REFS_PER_NAMESPACE)) {
    const [objectName = '', objectType = '', peeledName = '', peeledType = '', refName = ''] =
      record.split('\0')
    const revision = peeledCommitOid(objectName, objectType, peeledName, peeledType)
    if (!revision || !refName || /^refs\/remotes\/[^/]+\/HEAD$/.test(refName)) {
      continue
    }
    refs.push(gitHistoryRefFromFullName(refName, refName, revision))
  }
  return { refs, truncated: records.length > GIT_GRAPH_MAX_REFS_PER_NAMESPACE }
}

function scopeTips(
  scope: GitGraphScope,
  headOid: string | undefined,
  heads: readonly GitHistoryItemRef[],
  remotes: readonly GitHistoryItemRef[],
  selectedRef: GitHistoryItemRef | undefined,
  selectedRefs: readonly GitHistoryItemRef[]
): string[] {
  const tipRefs =
    scope === 'local'
      ? heads
      : scope === 'all'
        ? [...heads, ...remotes]
        : scope === 'ref' && selectedRef
          ? [selectedRef]
          : scope === 'refs'
            ? selectedRefs
            : []
  const tips = new Set<string>()
  // Why HEAD in every scope: a detached HEAD is under no ref namespace but is still the checkout.
  if (headOid) {
    tips.add(headOid)
  }
  for (const ref of tipRefs) {
    if (ref.revision) {
      tips.add(ref.revision)
    }
  }
  return [...tips]
}

function indexRefsByOid(refs: readonly GitHistoryItemRef[]): Map<string, GitHistoryItemRef[]> {
  const refsByOid = new Map<string, GitHistoryItemRef[]>()
  for (const item of refs) {
    if (item.revision) {
      const labels = refsByOid.get(item.revision) ?? []
      labels.push(item)
      refsByOid.set(item.revision, labels)
    }
  }
  return refsByOid
}

/** Resolves HEAD, capped ref listings and the scope's tip set once, for every later page. */
export async function captureGitGraphSnapshot(
  git: GitGraphExecutor,
  cwd: string,
  scope: GitGraphScope,
  ref: string | undefined,
  selectedRefNames: readonly string[] | undefined,
  repositoryKey: string
): Promise<GitGraphSnapshot> {
  const isShallow = await probeShallowRepository(git, cwd)
  const headOid = (await resolveCommit(git, cwd, 'HEAD')) ?? undefined
  const [current, heads, remotes, tags, selectedRef, resolvedRefs] = await Promise.all([
    headOid ? resolveCurrentRef(git, cwd, headOid) : undefined,
    listNamespaceRefs(git, cwd, 'refs/heads'),
    listNamespaceRefs(git, cwd, 'refs/remotes'),
    listNamespaceRefs(git, cwd, 'refs/tags'),
    ref ? resolveNamedRef(git, cwd, ref) : undefined,
    Promise.all((selectedRefNames ?? []).map((name) => resolveNamedRef(git, cwd, name)))
  ])
  if (ref && !selectedRef) {
    throw new Error(GIT_GRAPH_REF_NOT_FOUND_CODE)
  }
  const selectedRefs = resolvedRefs.filter((item): item is GitHistoryItemRef => item !== undefined)
  const missing =
    selectedRefNames?.filter((_name, index) => resolvedRefs[index] === undefined).sort() ?? []
  const missingRefs = missing.length > 0 ? missing : undefined

  const refsById = new Map<string, GitHistoryItemRef>()
  for (const item of [...heads.refs, ...remotes.refs, ...tags.refs]) {
    refsById.set(item.id, item)
  }
  // Why: a selected ref outside the capped listing still labels its own tip.
  if (selectedRef && selectedRef.category !== 'commits' && !refsById.has(selectedRef.id)) {
    refsById.set(selectedRef.id, selectedRef)
  }
  for (const item of selectedRefs) {
    if (item.category !== 'commits' && !refsById.has(item.id)) {
      refsById.set(item.id, item)
    }
  }
  const resolvedRefList = [...refsById.values()].sort(compareGitHistoryItemRefsByCategory)

  return {
    repositoryKey,
    scope,
    ...(ref ? { ref } : {}),
    ...(selectedRefNames ? { selectedRefs: [...selectedRefNames].sort() } : {}),
    ...(missingRefs ? { missingRefs } : {}),
    tips: scopeTips(scope, headOid, heads.refs, remotes.refs, selectedRef, selectedRefs),
    refs: resolvedRefList,
    refsByOid: indexRefsByOid(resolvedRefList),
    ...(headOid ? { headOid } : {}),
    ...(current ? { currentRef: current.currentRef } : {}),
    isShallow,
    refsTruncated: heads.truncated || remotes.truncated || tags.truncated
  }
}
