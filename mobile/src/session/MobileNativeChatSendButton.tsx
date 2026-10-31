import { useState } from 'react'
import { ArrowUp, CornerDownRight, ListEnd } from 'lucide-react-native'
import { Pressable } from 'react-native'
import type {
  NativeChatFollowUpBehavior,
  NativeChatSendFollowUp
} from '../../../src/shared/native-chat-follow-up-behavior'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { colors } from '../theme/mobile-theme'
import { mobileNativeChatComposerStyles as styles } from './mobile-native-chat-composer-styles'
import type { MobileNativeChatSendIntent } from './mobile-native-chat-send'

const FOLLOW_UP_ICON = { queue: ListEnd, steer: CornerDownRight } as const

export function MobileNativeChatSendButton({
  canSend,
  sendFollowUp,
  onSend
}: {
  canSend: boolean
  sendFollowUp: NativeChatSendFollowUp | null
  onSend: (intent?: MobileNativeChatSendIntent) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = { queue: 'Queue', steer: 'Steer' }
  const hint = {
    queue: 'Runs after the current turn',
    steer: 'Goes into what the agent is doing now'
  }
  const action = sendFollowUp?.action
  const Icon = action ? FOLLOW_UP_ICON[action] : ArrowUp
  const choices: NativeChatFollowUpBehavior[] =
    action === 'queue' ? ['queue', 'steer'] : ['steer', 'queue']
  return (
    <>
      <Pressable
        onPress={() => onSend()}
        onLongPress={sendFollowUp?.offersChoice && canSend ? () => setOpen(true) : undefined}
        disabled={!canSend}
        accessibilityLabel={action ? label[action] : 'Send message'}
        style={({ pressed }) => [
          styles.sendButton,
          !canSend && styles.sendButtonDisabled,
          pressed && canSend && styles.pressed
        ]}
      >
        <Icon size={19} color={canSend ? colors.bgBase : colors.textMuted} strokeWidth={2.4} />
      </Pressable>
      <ActionSheetModal
        visible={open}
        onClose={() => setOpen(false)}
        actions={choices.map((choice) => ({
          id: choice,
          label: label[choice],
          hint: hint[choice],
          icon: FOLLOW_UP_ICON[choice],
          checked: choice === action,
          onPress: () => (choice === action ? onSend() : onSend({ alternate: true }))
        }))}
      />
    </>
  )
}
