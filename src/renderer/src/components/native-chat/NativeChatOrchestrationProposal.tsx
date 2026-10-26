import { createContext, useCallback, useContext, type ReactNode, type RefObject } from 'react'
import { ListTree, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import {
  nativeChatOrchestrationAssignment,
  nativeChatOrchestrationAttributes,
  type OrchestrationAgentSelection
} from './native-chat-orchestration-instruction'

const InsertProposalContext = createContext<
  ((selection: OrchestrationAgentSelection) => void) | null
>(null)

export function NativeChatOrchestrationProposalProvider({
  composerRef,
  available,
  children
}: {
  composerRef: RefObject<Pick<NativeChatComposerHandle, 'acceptsText' | 'appendText'> | null> | null
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
  return (
    <InsertProposalContext.Provider value={available ? insert : null}>
      {children}
    </InsertProposalContext.Provider>
  )
}

export function NativeChatOrchestrationProposal({
  selection,
  actionable
}: {
  selection: OrchestrationAgentSelection
  actionable: boolean
}): React.JSX.Element {
  const insert = useContext(InsertProposalContext)
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
      {actionable && insert ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label={addLabel}
              onClick={() => insert(selection)}
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
