import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  hostSupportsConversationSummary,
  readConversationSummary
} from '@/runtime/conversation-summary-client'
import { structuredAgentSessionTargetForHost } from '@/runtime/structured-agent-session-owner'
import type { ProjectMapAgent } from './project-map-graph'

type Found = { text: string; stale: boolean } | 'none' | 'old' | null

/** "Hand off with its summary": the source's saved summary, if its host has one to give. */
export function ProjectMapForkSummaryOption({
  source,
  onChange
}: {
  source: ProjectMapAgent | undefined
  onChange: (summary: string | null) => void
}): React.JSX.Element {
  const [found, setFound] = useState<Found>(null)
  const [checked, setChecked] = useState(false)
  const sessionId = source?.chat?.sessionId
  const hostId = source?.chat?.executionHostId

  useEffect(() => {
    setFound(null)
    setChecked(false)
    const target = sessionId ? structuredAgentSessionTargetForHost(hostId) : null
    if (!target || !sessionId) {
      setFound('none')
      return
    }
    let cancelled = false
    void (async () => {
      if (!(await hostSupportsConversationSummary(target))) {
        return !cancelled && setFound('old')
      }
      const state = await readConversationSummary(target, sessionId).catch(() => null)
      if (!cancelled) {
        setFound(state?.summary ? { text: state.summary.text, stale: state.stale } : 'none')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hostId, sessionId])

  const usable = found !== null && typeof found === 'object' ? found : null
  useEffect(() => {
    onChange(checked && usable ? usable.text : null)
  }, [checked, onChange, usable])

  const hint = usable?.stale
    ? translate(
        'projectMap.fork.useSummaryStale',
        'This summary is out of date; the chat has new messages.'
      )
    : found === 'old'
      ? translate('projectMap.fork.useSummaryOld', 'This host is too old to summarize chats.')
      : found === 'none'
        ? translate(
            'projectMap.fork.useSummaryNone',
            "No summary yet: generate one from the chat's menu."
          )
        : null
  return (
    <label className="flex flex-col gap-0.5 text-[12.5px]">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-current"
          data-project-map-fork-use-summary=""
          checked={checked}
          disabled={!usable}
          onChange={(event) => setChecked(event.target.checked)}
        />
        {translate('projectMap.fork.useSummary', 'Hand off with its summary')}
      </span>
      {hint ? <span className="pl-6 text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}
