import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import {
  ORCA_CLI_RUNTIME_CLIENT_CAPABILITY,
  agentDelegationRequestOfCard,
  assignmentCardsInSubmittedText
} from '../../../../shared/agent-delegation-grant'
import type { AgentDelegationGrantRow } from '../../orchestration/db/delegation-grants/agent-delegation-grant-store'
import type { OrchestrationAgentSelection } from '../../../../shared/native-chat-orchestration-reference'
import { isOrcaSessionId } from '../../../../shared/orca-session-address'
import { sessionDelegationHolderKey } from '../../agent-delegation-holder'
import { canonicalOrcaSessionId } from '../../orchestration/canonical-orca-session-id'
import type { RpcContext } from '../core'
import { rpcCallerOperationKey } from '../rpc-caller-identity'

type PersonClientContext = Pick<RpcContext, 'caller' | 'clientKind' | 'clientCapabilities'>

// What the `orca` CLI advertises over a paired socket, today and before it marked itself.
const CLI_CLIENT_CAPABILITIES: ReadonlySet<string> = new Set([
  AGENT_LAUNCH_RUNTIME_CAPABILITY,
  ORCA_CLI_RUNTIME_CLIENT_CAPABILITY
])

/**
 * Whether the transport proved a person's client: this host's window, a paired phone, or a paired
 * desktop or web client. The CLI socket is any local agent's; a paired runtime credential is shared
 * by the remote `orca` CLI, told apart by the capabilities its socket negotiated.
 */
export function isPersonClientCaller(context: PersonClientContext): boolean {
  const { caller } = context
  if (caller?.kind === 'desktop') {
    return true
  }
  const capabilities = context.clientCapabilities ?? []
  // The CLI also pairs with a phone's offer, so its own marker outranks the credential's scope.
  if (
    caller?.kind !== 'paired-device' ||
    capabilities.includes(ORCA_CLI_RUNTIME_CLIENT_CAPABILITY)
  ) {
    return false
  }
  return (
    context.clientKind === 'mobile' ||
    capabilities.some((capability) => !CLI_CLIENT_CAPABILITIES.has(capability))
  )
}

type SubmittedMessage = {
  sessionId: string
  operationId: string
  /** The journal id the message is handed to the agent under; a send's is its operation id. */
  messageId: string
  blocks: readonly ({ type: 'text'; text: string } | { type: string })[]
  /** The composer's assignment pills, sent beside the text; text alone authorizes nothing. */
  cards: readonly OrchestrationAgentSelection[] | undefined
}

/**
 * The submitted pills the agent will also read in the message text, one text card per pill. A
 * pill whose card is not in the text, or a card URL typed or pasted as text, authorizes nothing.
 */
function submittedCards(message: SubmittedMessage): OrchestrationAgentSelection[] {
  if (!message.cards?.length) {
    return []
  }
  const text = message.blocks
    .flatMap((block) => ('text' in block && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
  const inText = assignmentCardsInSubmittedText(text).map(cardIdentity)
  return message.cards.filter((card) => {
    const index = inText.indexOf(cardIdentity(card))
    if (index === -1) {
      return false
    }
    inText.splice(index, 1)
    return true
  })
}

function cardIdentity(card: OrchestrationAgentSelection): string {
  return JSON.stringify([
    card.agent,
    card.label,
    card.count,
    card.task,
    card.model?.id ?? null,
    card.model?.label ?? null,
    card.effort ?? null
  ])
}

type GrantContext = Pick<RpcContext, 'runtime'> & PersonClientContext

/**
 * Records the agents a person authorized with the cards of a message they submitted to one chat.
 * They authorize nothing until the chat's journal shows the message handed to its agent, so a
 * turn already running cannot spend cards still queued, refused or never delivered. Returns the
 * authorization id, or null when nothing was recorded.
 */
function recordSubmittedAuthorization(
  context: GrantContext,
  message: SubmittedMessage
): string | null {
  const sourceKey = submissionSourceKey(context, message)
  if (!sourceKey || !isPersonClientCaller(context) || !isOrcaSessionId(message.sessionId)) {
    return null
  }
  const cards = submittedCards(message)
  if (cards.length === 0) {
    return null
  }
  return context.runtime.getOrchestrationDb().recordAgentDelegationGrants({
    holderKey: sessionDelegationHolderKey(canonicalOrcaSessionId(message.sessionId)),
    sourceKey,
    cards,
    sourceMessageId: message.messageId,
    awaitingDelivery: true
  })
}

function submissionSourceKey(
  context: PersonClientContext,
  message: Pick<SubmittedMessage, 'sessionId' | 'operationId'>
): string | null {
  return context.caller && isOrcaSessionId(message.sessionId)
    ? `${rpcCallerOperationKey(context.caller)}:${message.sessionId}:${message.operationId}`
    : null
}

/**
 * Runs a person's submission with its authorization recorded first, revokes it if the host does
 * not accept the message, and ties it to the queued card the message became, if any.
 */
export async function withSubmittedAgentDelegationGrants<
  T extends { ok: boolean; value?: unknown }
>(context: GrantContext, message: SubmittedMessage | null, submit: () => Promise<T>): Promise<T> {
  const authorizationId = message ? recordSubmittedAuthorization(context, message) : null
  let result: T
  try {
    result = await submit()
  } catch (error) {
    if (authorizationId) {
      context.runtime.getOrchestrationDb().revokeAgentDelegationAuthorization(authorizationId)
    }
    throw error
  }
  if (!authorizationId) {
    return result
  }
  const db = context.runtime.getOrchestrationDb()
  if (!result.ok) {
    db.revokeAgentDelegationAuthorization(authorizationId)
    return result
  }
  const queuedMessageId = queuedMessageIdOf(result.value)
  if (queuedMessageId) {
    db.bindAgentDelegationAuthorizationMessage(authorizationId, queuedMessageId)
  }
  return result
}

function queuedMessageIdOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('submission' in value)) {
    return null
  }
  const { submission } = value
  return submission &&
    typeof submission === 'object' &&
    'queuedMessageId' in submission &&
    typeof submission.queuedMessageId === 'string'
    ? submission.queuedMessageId
    : null
}

/**
 * A queued card that is withdrawn never reaches the agent, and an edited one says what its new
 * text says: either way the authorization its old text carried goes. An edit by a person records
 * the cards of the new text in its place.
 */
export function revokeQueuedMessageAgentDelegation(
  context: GrantContext,
  change: QueuedMessageChange
): void {
  try {
    reconcileQueuedMessageAgentDelegation(context, change)
  } catch (error) {
    // The host already committed the change, so the client's request must not read as refused.
    console.warn('[agent-delegation] queued message authorization not reconciled', error)
  }
}

type QueuedMessageChange = {
  sessionId: string
  messageId: string
  operationId: string
  edited?: { text: string; cards: readonly OrchestrationAgentSelection[] | undefined }
}

function reconcileQueuedMessageAgentDelegation(
  context: GrantContext,
  change: QueuedMessageChange
): void {
  if (!isOrcaSessionId(change.sessionId)) {
    return
  }
  const holderKey = sessionDelegationHolderKey(canonicalOrcaSessionId(change.sessionId))
  // A profile with no orchestration database holds no authorization to revoke.
  const existing = context.runtime.getExistingOrchestrationDb()
  const confirmed =
    existing
      ?.listAgentDelegationGrants(holderKey)
      .filter((grant) => grant.source_message_id === change.messageId && !grant.superseded_by) ?? []
  for (const authorizationId of existing?.listAgentDelegationAuthorizationsForMessage(
    holderKey,
    change.messageId,
    submissionSourceKey(context, change) ?? ''
  ) ?? []) {
    existing?.revokeAgentDelegationAuthorization(authorizationId)
  }
  if (!change.edited) {
    return
  }
  recordSubmittedAuthorization(context, {
    sessionId: change.sessionId,
    operationId: change.operationId,
    messageId: change.messageId,
    blocks: [{ type: 'text', text: change.edited.text }],
    cards: change.edited.cards ?? cardsKeptByEdit(confirmed, change.edited.text)
  })
}

/**
 * An edit field is plain text, so an edit names no pills of its own. The cards the person already
 * sent with this message stay authorized where the edited text keeps them exactly; a card that is
 * new or changed authorizes nothing until it is sent from the composer.
 */
function cardsKeptByEdit(
  confirmed: readonly AgentDelegationGrantRow[],
  editedText: string
): OrchestrationAgentSelection[] {
  const unmatched = [...confirmed]
  return assignmentCardsInSubmittedText(editedText).filter((card) => {
    const request = agentDelegationRequestOfCard(card)
    const index = unmatched.findIndex(
      (grant) =>
        grant.agent === request.agent &&
        grant.model === request.model &&
        grant.effort === request.effort &&
        grant.count === card.count &&
        grant.task === card.task
    )
    if (index === -1) {
      return false
    }
    unmatched.splice(index, 1)
    return true
  })
}
