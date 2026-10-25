import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

export function getAgentReplyRulesSearchEntry(): SettingsSearchEntry {
  return {
    title: translate(
      'auto.components.settings.experimental.search.agentReplyRules.title',
      'Agent reply rules'
    ),
    description: translate(
      'auto.components.settings.experimental.search.agentReplyRules.description',
      'Extra instructions Chat UI sends to Claude and Codex.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.claude',
        'claude'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.nativeChat.codex',
        'codex'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.agentReplyRules.chinese',
        'chinese'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.agentReplyRules.concise',
        'concise'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.agentReplyRules.safety',
        'safety'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.agentReplyRules.prompt',
        'prompt'
      )
    ],
    targetSectionId: 'experimental-agent-reply-rules'
  }
}
