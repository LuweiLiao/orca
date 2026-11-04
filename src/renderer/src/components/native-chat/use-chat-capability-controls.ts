import type { RefObject } from 'react'
import { getNativeChatAgentProfile } from '../../../../shared/native-chat-agent-profiles'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'
import type { useStructuredAgentSession } from './use-structured-agent-session'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import type { NativeChatCapabilityControls } from './NativeChatCapabilityList'
import { useNativeChatSkills } from './use-native-chat-skills'

export function useChatCapabilityControls(
  props: Pick<NativeChatStructuredViewProps, 'agent' | 'tabId' | 'isVisible'>,
  controller: Pick<
    ReturnType<typeof useStructuredAgentSession>,
    'chatCapabilities' | 'sessionCommands' | 'setChatCapabilities'
  >,
  composerRef: RefObject<NativeChatComposerHandle | null>,
  canUseSkill: boolean
): NativeChatCapabilityControls {
  const discovered = useNativeChatSkills(props.agent, props.tabId, props.isVisible)
  const profile = getNativeChatAgentProfile(props.agent)
  return {
    capabilities: controller.chatCapabilities,
    commands: [
      ...(controller.sessionCommands === undefined ||
      controller.sessionCommands.some((command) => command.kindUnspecified) ||
      profile?.keepsScannedSkills
        ? discovered.skills.map((skill) => ({
            name: skill.name,
            description: skill.description ?? undefined,
            path: skill.skillFilePath,
            kind: 'skill' as const
          }))
        : []),
      ...(controller.sessionCommands ?? [])
    ],
    onChange: controller.setChatCapabilities,
    canUseSkill,
    onUseSkill: (name, path) => {
      composerRef.current?.insertSkill?.(`${profile?.skillPrefix ?? '/'}${name}`, path)
    }
  }
}
