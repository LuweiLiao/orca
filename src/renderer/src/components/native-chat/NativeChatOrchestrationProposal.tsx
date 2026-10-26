import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
  type RefObject
} from 'react'
import { ListTree, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { assignmentCardsInSubmittedText } from '../../../../shared/agent-delegation-grant'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import {
  nativeChatOrchestrationAssignment,
  nativeChatOrchestrationAttributes,
  nativeChatOrchestrationSeparator,
  type OrchestrationAgentSelection
} from './native-chat-orchestration-instruction'

type ProposalComposer = Pick<
  NativeChatComposerHandle,
  'acceptsText' | 'appendText' | 'appendTextAndSend'
>
type ProposalActions = {
  insert: (selection: OrchestrationAgentSelection) => void
  /** Every card at once; sent as the person's message when the composer was empty. */
  insertAll: (selections: readonly OrchestrationAgentSelection[]) => void
}

const ProposalActionsContext = createContext<ProposalActions | null>(null)

export function NativeChatOrchestrationProposalProvider({
  composerRef,
  available,
  children
}: {
  composerRef: RefObject<ProposalComposer | null> | null
  available: boolean
  children: ReactNode
}): React.JSX.Element {
  const insert = useCallback(
    (selection: OrchestrationAgentSelection) => {
      const composer = composerRef?.current
      if (composer?.acceptsText()) {
        composer.appendText(nativeChatOrchestrationAttributes(selection).token)
      }
    },
    [composerRef]
  )
  const insertAll = useCallback(
    (selections: readonly OrchestrationAgentSelection[]) => {
      const composer = composerRef?.current
      if (!composer?.acceptsText()) {
        return
      }
      const text = selections
        .map((selection) => nativeChatOrchestrationAttributes(selection).token)
        .join(nativeChatOrchestrationSeparator())
      if (composer.appendTextAndSend) {
        composer.appendTextAndSend(text)
      } else {
        composer.appendText(text)
      }
    },
    [composerRef]
  )
  const actions = useMemo(() => ({ insert, insertAll }), [insert, insertAll])
  return (
    <ProposalActionsContext.Provider value={available ? actions : null}>
      {children}
    </ProposalActionsContext.Provider>
  )
}

export function NativeChatOrchestrationProposal({
  selection,
  actionable
}: {
  selection: OrchestrationAgentSelection
  actionable: boolean
}): React.JSX.Element {
  const actions = useContext(ProposalActionsContext)
  const addLabel = translate(
    'components.native-chat.composer.addOrchestrationToMessage',
    'Add to message'
  )
  return (
    <Badge
      variant="orchestrationPill"
      data-native-chat-orchestration={selection.agent}
      className="whitespace-normal text-left"
    >
      <ListTree aria-hidden="true" className="size-3 shrink-0" />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
        {nativeChatOrchestrationAssignment(selection)}
      </span>
      {actionable && actions ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label={addLabel}
              onClick={() => actions.insert(selection)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {addLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </Badge>
  )
}

/** One action for every card a reply proposes, so confirming them is one click and not one each. */
export function NativeChatOrchestrationProposalActions({
  markdown
}: {
  markdown: string
}): React.JSX.Element | null {
  const actions = useContext(ProposalActionsContext)
  const cards = useMemo(() => {
    const unique = new Map<string, OrchestrationAgentSelection>()
    for (const card of assignmentCardsInSubmittedText(markdown)) {
      unique.set(JSON.stringify(card), card)
    }
    return [...unique.values()]
  }, [markdown])
  if (!actions || cards.length === 0) {
    return null
  }
  const label =
    cards.length === 1
      ? translate('components.native-chat.composer.addProposalAndSend', 'Add and send')
      : translate(
          'components.native-chat.composer.addAllProposalsAndSend',
          'Add all {{count}} and send',
          {
            count: cards.length
          }
        )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mt-2"
          onClick={() => actions.insertAll(cards)}
        >
          <ListTree aria-hidden="true" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {translate(
          'components.native-chat.composer.addProposalsAndSendHint',
          'Sends the cards as your message. With a draft in the message box, they are added to it instead.'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
