import type { AgentLaunchChoices } from './agent-launch-choices'
import type { BrowserLinkOpeningSettings } from './browser-link-opening-settings'
import type { ClaudeAccountSwitchSettings } from './claude-account-switch-settings'
import type { ExternalConversationSettings } from './external-conversation-settings'
import type { NativeChatGlobalSettings } from './native-chat-appearance-settings'
import type { WorktreeDeletionPreferences } from './worktree-deletion-preferences'
import type { AgentPermissionGlobalSettings } from './tui-agent-permission-choice'
import type { AgentReplyRuleSettings } from './agent-reply-rule-settings'
import type { ProjectMapSettings } from './project-map-settings'

/** Settings groups owned by their feature modules and composed into GlobalSettings. */
export type GlobalSettingsBase = NativeChatGlobalSettings &
  WorktreeDeletionPreferences &
  ClaudeAccountSwitchSettings &
  AgentPermissionGlobalSettings &
  ExternalConversationSettings &
  BrowserLinkOpeningSettings &
  AgentReplyRuleSettings &
  ProjectMapSettings & { agentLaunchChoices?: AgentLaunchChoices }
