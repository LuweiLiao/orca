import { expect, it } from 'vitest'
import { assignmentCardsInSubmittedText } from '../../../../../shared/native-chat-orchestration-reference'
import {
  hideNativeChatTextDelegation,
  showNativeChatTextDelegation,
  withNativeChatTextDelegation
} from './native-chat-text-delegation-store'

const typed = '创建2个claude opus分析下'
const card = {
  agent: 'claude',
  label: 'Claude',
  count: 2,
  task: '',
  model: { id: 'opus', label: 'claude-opus-5-5' }
}

it('adds the cards a composer showed only to the exact draft it showed them for', () => {
  const owner = {}
  showNativeChatTextDelegation('scope', { owner, typed, cards: [card] })

  const sent = withNativeChatTextDelegation('scope', typed, { text: typed, holdsCards: false })
  expect(sent.startsWith(typed)).toBe(true)
  expect(assignmentCardsInSubmittedText(sent)).toEqual([card])

  const edited = `${typed}，再加点细节`
  expect(withNativeChatTextDelegation('scope', edited, { text: edited, holdsCards: false })).toBe(
    edited
  )
  expect(withNativeChatTextDelegation('scope', typed, { text: typed, holdsCards: true })).toBe(
    typed
  )
  // A token after an unclosed fence would reach the agent as code, so it is not added at all.
  const unclosedFence = `${typed}\n\`\`\`ts`
  showNativeChatTextDelegation('scope', { owner, typed: unclosedFence, cards: [card] })
  expect(
    withNativeChatTextDelegation('scope', unclosedFence, { text: unclosedFence, holdsCards: false })
  ).toBe(unclosedFence)
})

it('keeps what one composer of a chat showed when another composer of the chat goes away', () => {
  const owner = {}
  showNativeChatTextDelegation('shared', { owner, typed, cards: [card] })
  hideNativeChatTextDelegation('shared', {})
  expect(
    withNativeChatTextDelegation('shared', typed, { text: typed, holdsCards: false })
  ).not.toBe(typed)
  hideNativeChatTextDelegation('shared', owner)
  expect(withNativeChatTextDelegation('shared', typed, { text: typed, holdsCards: false })).toBe(
    typed
  )
})
