import { expect, it } from 'vitest'
import {
  chatNamingModelArgument,
  replaceChatNamingModelArgument
} from './chat-naming-model-arguments'
import { planCommitMessageGeneration } from './commit-message-plan'

it.each(['--model old', '-m old', '--model=old', '-mold'])(
  'replaces %s without leaving a stale model in the real launch plan',
  (args) => {
    const changed = replaceChatNamingModelArgument(
      `${args} --model duplicate -c custom=value`,
      'new-model'
    )
    expect(chatNamingModelArgument(changed)).toBe('new-model')
    const planned = planCommitMessageGeneration(
      { agentId: 'codex', model: 'gpt-5.6-terra', agentArgs: changed },
      'Name this chat'
    )
    expect(planned.ok).toBe(true)
    if (!planned.ok) {
      return
    }
    expect(planned.plan.args.filter((arg) => arg === '--model')).toHaveLength(1)
    expect(planned.plan.args).toContain('new-model')
    expect(planned.plan.args).not.toContain('old')
    expect(planned.plan.args).not.toContain('duplicate')
    expect(planned.plan.args).not.toContain('gpt-5.6-terra')
    expect(planned.plan.args).toContain('custom=value')
  }
)
