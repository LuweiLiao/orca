import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getAgentSudoExperimentalSearchEntry = createLocalizedCatalog(
  (): SettingsSearchEntry => ({
    title: translate('auto.components.settings.agentSudo.search.title', 'sudo password'),
    description: translate(
      'auto.components.settings.agentSudo.search.description',
      'Save your sudo password so agents in local terminals stop hanging on sudo, with optional automatic entry.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.experimental.search.0d24759f14',
        'experimental'
      ),
      ...translateSearchKeyword('auto.components.settings.agentSudo.search.sudo', 'sudo'),
      ...translateSearchKeyword('auto.components.settings.agentSudo.search.password', 'password'),
      ...translateSearchKeyword('auto.components.settings.agentSudo.search.root', 'root'),
      ...translateSearchKeyword('auto.components.settings.agentSudo.search.agent', 'agent'),
      ...translateSearchKeyword('auto.components.settings.agentSudo.search.terminal', 'terminal')
    ],
    targetSectionId: 'experimental-agent-sudo'
  })
)
