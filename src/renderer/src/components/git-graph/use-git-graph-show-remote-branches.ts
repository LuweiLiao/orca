import { useAppStore } from '../../store'

/** "Show remote branches", shared by every Git Graph tab and persisted with the UI state. */
export function useGitGraphShowRemoteBranches(): [boolean, (next: boolean) => void] {
  const value = useAppStore((s) => s.gitGraphShowRemoteBranches)
  const setValue = useAppStore((s) => s.setGitGraphShowRemoteBranches)
  return [value, setValue]
}
