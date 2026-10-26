import { useEffect, useState } from 'react'
import { Loader2, Lock, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { AgentSudoStatus } from '../../../../shared/agent-sudo-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getAgentSudoExperimentalSearchEntry } from './agent-sudo-experimental-search'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AgentSudoExperimentalSetting(): React.JSX.Element | null {
  const api = typeof window === 'undefined' ? undefined : window.api?.agentSudo
  const [status, setStatus] = useState<AgentSudoStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      ?.getStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus(next)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api])

  if (!api || !status?.supported) {
    return null
  }

  const entry = getAgentSudoExperimentalSearchEntry()
  const autoEnabled = status.mode === 'auto'
  // Mirrors main's save rule so the refusal is explained up front, not after typing.
  const canSave = status.protectionGap === null
  const run = async (
    action: () => Promise<AgentSudoStatus>,
    onDone?: () => void
  ): Promise<void> => {
    setPending(true)
    try {
      setStatus(await action())
      onDone?.()
    } catch (error) {
      toast.error(
        translate(
          'auto.components.settings.AgentSudoExperimentalSetting.saveFailed',
          'Could not update the sudo password'
        ),
        { description: errorMessage(error) }
      )
    } finally {
      setPending(false)
    }
  }
  const save = (): void => {
    if (draft && canSave) {
      void run(
        () => api.savePassword(draft),
        () => setDraft('')
      )
    }
  }

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-agent-sudo"
    >
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor="agent-sudo-password">{entry.title}</Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.AgentSudoExperimentalSetting.description',
            'Agents run commands without a terminal to type into, so sudo waits forever for a password. Save it here and Orca answers sudo in local terminals opened afterwards. SSH and WSL terminals are not covered.'
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="agent-sudo-password"
          type="password"
          autoComplete="off"
          value={draft}
          disabled={pending || !canSave}
          placeholder={
            status.configured
              ? translate(
                  'auto.components.settings.AgentSudoExperimentalSetting.configured',
                  'Password saved'
                )
              : translate(
                  'auto.components.settings.AgentSudoExperimentalSetting.placeholder',
                  'Your login password'
                )
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save()
            }
          }}
        />
        <Button size="sm" disabled={pending || !draft || !canSave} onClick={save}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {status.configured
            ? translate('auto.components.settings.AgentSudoExperimentalSetting.replace', 'Replace')
            : translate('auto.components.settings.AgentSudoExperimentalSetting.save', 'Save')}
        </Button>
        {status.configured ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void run(() => api.clearPassword())}
          >
            {translate('auto.components.settings.AgentSudoExperimentalSetting.remove', 'Remove')}
          </Button>
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 shrink space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.AgentSudoExperimentalSetting.autoTitle',
              'Enter password automatically'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {autoEnabled
              ? translate(
                  'auto.components.settings.AgentSudoExperimentalSetting.autoOn',
                  'Orca enters the password without asking. Any command in an Orca terminal, including one a prompt-injected agent runs, gets root.'
                )
              : translate(
                  'auto.components.settings.AgentSudoExperimentalSetting.autoOff',
                  'Off: Orca shows each sudo command and waits for you to allow it. Unanswered requests are denied after two minutes.'
                )}
          </p>
        </div>
        <SettingsSwitch
          checked={autoEnabled}
          disabled={pending || !status.configured}
          ariaLabel={translate(
            'auto.components.settings.AgentSudoExperimentalSetting.autoToggleLabel',
            'Toggle automatic sudo password entry'
          )}
          onChange={() => void run(() => api.setMode(autoEnabled ? 'confirm' : 'auto'))}
        />
      </div>
      {status.rejected ? (
        <p role="alert" className="flex items-start gap-2 text-xs text-status-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {translate(
            'auto.components.settings.AgentSudoExperimentalSetting.rejected',
            'sudo rejected the saved password, so Orca stopped entering it. Save the correct password to resume.'
          )}
        </p>
      ) : null}
      {status.protectionGap ? (
        <p role="alert" className="flex items-start gap-2 text-xs text-status-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {translate(
            'auto.components.settings.AgentSudoExperimentalSetting.storageUnavailable',
            'Saving is disabled: a sudo password needs real OS keyring protection. {{reason}}',
            { reason: status.protectionGap }
          )}
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Lock className="size-3 shrink-0" />
        {translate(
          'auto.components.settings.AgentSudoExperimentalSetting.storage',
          'Sealed with your OS keyring and never sent to paired phones or web clients.'
        )}
      </p>
    </SearchableSetting>
  )
}
