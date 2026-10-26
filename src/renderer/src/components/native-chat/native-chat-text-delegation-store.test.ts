import { expect, it } from 'vitest'
import { assignmentCardsInSubmittedText } from '../../../../shared/agent-delegation-grant'
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

it('sends the cards a composer showed only with the exact draft it showed them for', () => {
  const owner = {}
  showNativeChatTextDelegation('scope', { owner, typed, cards: [card] })

  const sent = withNativeChatTextDelegation('scope', typed, { text: typed, cards: [] })
  expect(sent.cards).toEqual([card])
  expect(sent.text.startsWith(typed)).toBe(true)
  // The host authorizes a pill only when the agent will read the same card in the text.
  expect(assignmentCardsInSubmittedText(sent.text)).toEqual([card])

  const edited = `${typed}，再加点细节`
  expect(withNativeChatTextDelegation('scope', edited, { text: edited, cards: [] })).toEqual({
    text: edited,
    cards: []
  })
  const picked = { ...card, count: 1 }
  expect(withNativeChatTextDelegation('scope', typed, { text: typed, cards: [picked] })).toEqual({
    text: typed,
    cards: [picked]
  })
  // A token after an unclosed fence would reach the agent as code, so it is not sent at all.
  const unclosedFence = `${typed}\n\`\`\`ts`
  showNativeChatTextDelegation('scope', { owner, typed: unclosedFence, cards: [card] })
  expect(
    withNativeChatTextDelegation('scope', unclosedFence, { text: unclosedFence, cards: [] })
  ).toEqual({ text: unclosedFence, cards: [] })
})

it('keeps what one composer of a chat showed when another composer of the chat goes away', () => {
  const owner = {}
  showNativeChatTextDelegation('shared', { owner, typed, cards: [card] })
  hideNativeChatTextDelegation('shared', {})
  expect(withNativeChatTextDelegation('shared', typed, { text: typed, cards: [] }).cards).toEqual([
    card
  ])
  hideNativeChatTextDelegation('shared', owner)
  expect(withNativeChatTextDelegation('shared', typed, { text: typed, cards: [] }).cards).toEqual(
    []
  )
})
