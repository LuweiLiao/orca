import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { AgentReplyRuleSettings } from '../../../../shared/agent-reply-rule-settings'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getExperimentalSearchEntry } from './experimental-search'

type AgentReplyRuleKey = keyof AgentReplyRuleSettings

type AgentReplyRulesExperimentalSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function AgentReplyRulesExperimentalSetting({
  settings,
  updateSettings
}: AgentReplyRulesExperimentalSettingProps): React.JSX.Element {
  const entry = getExperimentalSearchEntry().agentReplyRules
  const rules: { key: AgentReplyRuleKey; label: string; copy: string; toggleLabel: string }[] = [
    {
      key: 'experimentalClaudeChineseReplies',
      label: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.claudeChinese.label',
        'Claude: reply in Chinese'
      ),
      copy: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.claudeChinese.copy',
        'Adds a Simplified Chinese reply instruction to the system prompt Claude reads on every message. Thinking may stay in English.'
      ),
      toggleLabel: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.claudeChinese.toggleLabel',
        'Toggle Claude Chinese replies'
      )
    },
    {
      key: 'experimentalCodexTrustUserSafety',
      label: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.codexTrust.label',
        'Codex: trust my environment'
      ),
      copy: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.codexTrust.copy',
        'Takes your word on test environments and authorization, adds no safety measures you did not ask for, and does not overstate risk.'
      ),
      toggleLabel: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.codexTrust.toggleLabel',
        'Toggle Codex environment trust'
      )
    },
    {
      key: 'experimentalCodexConciseReplies',
      label: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.codexConcise.label',
        'Codex: concise replies'
      ),
      copy: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.codexConcise.copy',
        'Leads with the conclusion and drops preambles, recaps, and filler, including at high reasoning effort.'
      ),
      toggleLabel: translate(
        'auto.components.settings.ExperimentalPane.agentReplyRules.codexConcise.toggleLabel',
        'Toggle Codex concise replies'
      )
    }
  ]

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
      id="experimental-agent-reply-rules"
    >
      <div className="min-w-0 space-y-0.5">
        <Label>{entry.title}</Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.ExperimentalPane.agentReplyRules.copy',
            'Applies to Chat UI. Codex reads these when a chat is created; Claude reads them each time a chat starts or resumes its agent.'
          )}
        </p>
      </div>
      <div className="ml-4 space-y-3 border-l border-border pl-4">
        {rules.map((rule) => {
          const enabled = settings[rule.key] === true
          return (
            <div key={rule.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0 shrink space-y-0.5">
                <Label>{rule.label}</Label>
                <p className="text-xs text-muted-foreground">{rule.copy}</p>
              </div>
              <SettingsSwitch
                checked={enabled}
                ariaLabel={rule.toggleLabel}
                onChange={() => updateSettings({ [rule.key]: !enabled })}
              />
            </div>
          )
        })}
      </div>
    </SearchableSetting>
  )
}
