import { memo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import {
  parseAgentSessionHandoffMessage,
  type ParsedHandoffMessage
} from '../../../src/shared/agent-session-handoff-text'
import { deriveNativeChatRowContent } from '../../../src/shared/native-chat-row-content'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

const parsed = new WeakMap<NativeChatMessage, ParsedHandoffMessage | null>()

/** A hand-off child's first message, parsed once per message; null for any other row. */
export function mobileNativeChatHandoff(message: NativeChatMessage): ParsedHandoffMessage | null {
  if (message.role !== 'user' || message.from) {
    return null
  }
  let found = parsed.get(message)
  if (found === undefined) {
    found = parseAgentSessionHandoffMessage(deriveNativeChatRowContent(message.blocks).markdown)
    parsed.set(message, found)
  }
  return found
}

/** The message with only the person's instruction, for the bubble under the divider. */
export function mobileNativeChatHandoffInstruction(
  message: NativeChatMessage,
  handoff: ParsedHandoffMessage
): NativeChatMessage | null {
  return handoff.instruction
    ? { ...message, blocks: [{ type: 'text', text: handoff.instruction }] }
    : null
}

function label(handoff: ParsedHandoffMessage): string {
  const from = handoff.sourceLabels.join(', ')
  const head = from ? `Handed off from ${from}` : 'Handed off'
  return handoff.kind === 'summary' ? `${head}, compacted` : head
}

/** As desktop's `NativeChatHandoffRow`: a divider, and the carried context folded under it. */
export const MobileNativeChatHandoffDivider = memo(function MobileNativeChatHandoffDivider({
  handoff,
  fontScale
}: {
  handoff: ParsedHandoffMessage
  fontScale: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const text = label(handoff)
  const disclosure =
    handoff.kind === 'summary'
      ? 'Summary handed over'
      : handoff.handedOver
        ? `${handoff.handedOver.count} of ${handoff.handedOver.total} messages handed over`
        : 'Messages handed over'
  return (
    <View style={styles.root}>
      <View style={styles.divider} accessibilityRole="text" accessibilityLabel={text}>
        <View style={styles.rule} />
        <Text style={styles.label} numberOfLines={1}>
          {text}
        </Text>
        <View style={styles.rule} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.toggle}
      >
        <ChevronRight
          size={12}
          color={colors.textMuted}
          style={open ? styles.chevronOpen : undefined}
        />
        <Text style={styles.label}>{disclosure}</Text>
      </Pressable>
      {open ? (
        <ScrollView style={styles.context} nestedScrollEnabled>
          {handoff.kind === 'summary' ? (
            <MobileMarkdown content={handoff.context} textScale={fontScale} />
          ) : (
            <Text selectable style={styles.transcript}>
              {handoff.context}
            </Text>
          )}
        </ScrollView>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  root: { gap: spacing.xs, paddingVertical: spacing.xs },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle },
  label: { color: colors.textMuted, fontSize: typography.metaSize, flexShrink: 1 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs
  },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  context: {
    maxHeight: 360,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    borderRadius: radii.row,
    backgroundColor: colors.bgPanel,
    padding: spacing.md
  },
  transcript: { color: colors.textPrimary, fontSize: typography.metaSize }
})
