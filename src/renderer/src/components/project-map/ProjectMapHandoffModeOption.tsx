import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { hostSupportsAgentSessionForkSummary } from './use-project-map-lineage'

export type ProjectMapHandoffMode = 'summary' | 'messages'

/**
 * How a hand-off carries its source: a summary (the default, so the child starts nearly empty) or
 * the full history. A host too old to summarize offers only the history.
 */
export function useProjectMapHandoffMode(target: RuntimeClientTarget | null): {
  mode: ProjectMapHandoffMode
  setMode: (mode: ProjectMapHandoffMode) => void
  summaryAvailable: boolean | null
} {
  const [picked, setMode] = useState<ProjectMapHandoffMode>('summary')
  const [summaryAvailable, setSummaryAvailable] = useState<boolean | null>(null)
  const targetKey = target ? JSON.stringify(target) : null
  useEffect(() => {
    setSummaryAvailable(null)
    if (!target) {
      setSummaryAvailable(false)
      return
    }
    let cancelled = false
    void hostSupportsAgentSessionForkSummary(target).then((supported) => {
      if (!cancelled) {
        setSummaryAvailable(supported)
      }
    })
    return () => {
      cancelled = true
    }
    // Why the key: callers rebuild the target object every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])
  return {
    mode: summaryAvailable === false ? 'messages' : picked,
    setMode,
    summaryAvailable
  }
}

export function ProjectMapHandoffModeOption({
  mode,
  onChange,
  summaryAvailable,
  merge = false
}: {
  mode: ProjectMapHandoffMode
  onChange: (mode: ProjectMapHandoffMode) => void
  summaryAvailable: boolean | null
  merge?: boolean
}): React.JSX.Element {
  const options: { value: ProjectMapHandoffMode; label: string; hint: string }[] = [
    {
      value: 'summary',
      label: translate('projectMap.handoff.summary', 'Compact into a summary'),
      hint: merge
        ? translate(
            'projectMap.handoff.summaryMergeHint',
            'Summarizes the chats first; the new chat starts from that summary and can read the full messages when it needs them.'
          )
        : translate(
            'projectMap.handoff.summaryHint',
            'Summarizes the chat first; the new chat starts from that summary and can read the full messages when it needs them.'
          )
    },
    {
      value: 'messages',
      label: translate('projectMap.handoff.messages', 'Full history'),
      hint: translate(
        'projectMap.handoff.messagesHint',
        'Hands over the messages themselves; uses much more of the new chat’s context.'
      )
    }
  ]
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" data-project-map-handoff-mode={mode}>
      <legend className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
        {translate('projectMap.handoff.title', 'Hand over')}
      </legend>
      {options.map((option) => {
        const disabled = option.value === 'summary' && summaryAvailable === false
        const chosen = option.value === mode
        return (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-2.5 py-1.5',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              chosen ? 'border-ring bg-accent/60' : 'border-transparent hover:bg-accent/40'
            )}
          >
            <input
              type="radio"
              name="project-map-handoff-mode"
              className="mt-0.5 accent-current"
              data-project-map-handoff-mode-option={option.value}
              checked={chosen}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[12.5px] font-medium">{option.label}</span>
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                {disabled
                  ? translate(
                      'projectMap.handoff.summaryUnavailable',
                      'This host is too old to compact a hand-off.'
                    )
                  : option.hint}
              </span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
