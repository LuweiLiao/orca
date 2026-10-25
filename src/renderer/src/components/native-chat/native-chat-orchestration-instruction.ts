import { translate } from '@/i18n/i18n'
import {
  orchestrationReferenceToken,
  type OrchestrationAgentSelection
} from '../../../../shared/native-chat-orchestration-reference'
export type { OrchestrationAgentSelection } from '../../../../shared/native-chat-orchestration-reference'

export function nativeChatOrchestrationAssignment(selection: OrchestrationAgentSelection): string {
  const { label, count, model } = selection
  const assignment = translate(
    'components.native-chat.composer.orchestrationWorker',
    '{{count}} {{agent}} agent(s)',
    { count, agent: label }
  )
  const modelText = model
    ? translate('components.native-chat.composer.orchestrationModel', 'model: {{model}}', {
        model: model.id
      })
    : translate('components.native-chat.composer.defaultModel', 'Default model')
  const effortText = selection.effort ? `; effort: ${selection.effort}` : ''
  const taskText = selection.task.trim()
    ? `; ${translate('components.native-chat.composer.orchestrationTaskLabel', 'Task')}: ${selection.task.trim()}`
    : ''
  return `${assignment} (${modelText}${effortText})${taskText}`
}

export function nativeChatOrchestrationAttributes(selection: OrchestrationAgentSelection): {
  agent: string
  label: string
  count: number
  modelId: string
  modelLabel: string
  task: string
  effort: string
  token: string
} {
  return {
    agent: selection.agent,
    label: selection.label,
    count: selection.count,
    modelId: selection.model?.id ?? '',
    modelLabel: selection.model?.label ?? '',
    task: selection.task,
    effort: selection.effort ?? '',
    token: orchestrationReferenceToken(selection, nativeChatOrchestrationAssignment(selection))
  }
}

export function nativeChatOrchestrationSelection(
  attrs: Record<string, unknown>
): OrchestrationAgentSelection | null {
  if (
    typeof attrs.agent !== 'string' ||
    typeof attrs.label !== 'string' ||
    !attrs.agent ||
    !attrs.label
  ) {
    return null
  }
  return {
    agent: attrs.agent,
    label: attrs.label,
    task: typeof attrs.task === 'string' ? attrs.task : '',
    ...(typeof attrs.effort === 'string' && attrs.effort ? { effort: attrs.effort } : {}),
    count:
      typeof attrs.count === 'number' && Number.isInteger(attrs.count) && attrs.count > 0
        ? attrs.count
        : 1,
    ...(typeof attrs.modelId === 'string' && attrs.modelId
      ? {
          model: {
            id: attrs.modelId,
            label: typeof attrs.modelLabel === 'string' ? attrs.modelLabel : attrs.modelId
          }
        }
      : {})
  }
}

export function nativeChatOrchestrationSeparator(): string {
  return translate('components.native-chat.composer.orchestrationSeparator', '; ')
}
