import { describe, expect, it } from 'vitest'
import { getAgentSessionOptionLaunchCatalog } from './agent-session-option-catalog'

describe('getAgentSessionOptionLaunchCatalog', () => {
  it('gives the ccb launcher the Claude catalog', () => {
    const claude = getAgentSessionOptionLaunchCatalog('claude')
    expect(claude).not.toBeNull()
    expect(getAgentSessionOptionLaunchCatalog('ccb')).toBe(claude)
  })
})
