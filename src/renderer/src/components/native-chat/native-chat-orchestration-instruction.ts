import { translate } from '@/i18n/i18n'

export type OrchestrationAgentSelection = {
  agent: string
  label: string
  task: string
  count: number
  model?: { id: string; label: string }
}

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
  return `${assignment} (${modelText})`
}

export function nativeChatOrchestrationTaskPrefix(task: string): string {
  return task.trim()
    ? translate('components.native-chat.composer.orchestrationTaskPrefix', '{{task}}: ', {
        task: task.trim()
      })
    : ''
}

export function nativeChatOrchestrationAttributes(selection: OrchestrationAgentSelection): {
  agent: string
  label: string
  count: number
  modelId: string
  modelLabel: string
  token: string
} {
  return {
    agent: selection.agent,
    label: selection.label,
    count: selection.count,
    modelId: selection.model?.id ?? '',
    modelLabel: selection.model?.label ?? '',
    token: nativeChatOrchestrationAssignment(selection)
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
    task: '',
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
