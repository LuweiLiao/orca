import { describe, expect, it } from 'vitest'
import { PROJECT_FLOW_RUNTIME_CAPABILITY } from '../../../../shared/project-flow-event'
import { hostPublishesProjectFlow } from './project-flow-host-support'

describe('hostPublishesProjectFlow', () => {
  const capabilities: Record<string, string[]> = {
    new: [PROJECT_FLOW_RUNTIME_CAPABILITY],
    old: ['orchestration.contract.v1']
  }
  const capabilitiesOf = (environmentId: string): string[] | undefined =>
    capabilities[environmentId]

  it('trusts this machine and its SSH targets, which the app drives itself', () => {
    expect(hostPublishesProjectFlow('local', capabilitiesOf)).toBe(true)
    expect(hostPublishesProjectFlow(undefined, capabilitiesOf)).toBe(true)
    expect(hostPublishesProjectFlow('ssh:box', capabilitiesOf)).toBe(true)
  })

  it('trusts another runtime only when it announces the capability', () => {
    expect(hostPublishesProjectFlow('runtime:new', capabilitiesOf)).toBe(true)
    expect(hostPublishesProjectFlow('runtime:old', capabilitiesOf)).toBe(false)
    expect(hostPublishesProjectFlow('runtime:unknown', capabilitiesOf)).toBe(false)
  })
})
