import { describe, expect, it } from 'vitest'
import {
  admitFlowParticle,
  FLOW_HOLD_MS,
  holdFlowSignal,
  settleHeldFlowSignals,
  MAX_FLOW_PARTICLES,
  releaseFlowParticle,
  type FlowParticle
} from './project-flow-particles'

const particle = (id: string): FlowParticle => ({
  id,
  path: 'M0 0',
  reverse: false,
  tone: 'delegate'
})

describe('flow particles', () => {
  it('keeps one particle per signal', () => {
    const once = admitFlowParticle([], particle('a'))
    expect(admitFlowParticle(once, particle('a'))).toBe(once)
  })

  it('never holds more than 24, dropping the oldest for the newest', () => {
    let current: readonly FlowParticle[] = []
    for (let index = 0; index < MAX_FLOW_PARTICLES + 5; index += 1) {
      current = admitFlowParticle(current, particle(`p${index}`))
    }
    expect(current).toHaveLength(24)
    expect(current[0]?.id).toBe('p5')
    expect(current.at(-1)?.id).toBe(`p${MAX_FLOW_PARTICLES + 4}`)
  })

  it('releases only the finished particle', () => {
    const both = admitFlowParticle(admitFlowParticle([], particle('a')), particle('b'))
    expect(releaseFlowParticle(both, 'a').map((entry) => entry.id)).toEqual(['b'])
    expect(releaseFlowParticle(both, 'zzz')).toBe(both)
  })
})

describe('held flow signals', () => {
  const signal = { id: 's1', from: 'a', to: 'b', tone: 'delegate' as const }
  const route = { path: 'M0 0', reverse: false }

  it('waits for the node to be drawn, then flies once', () => {
    const held = holdFlowSignal([], signal, 1_000)
    const early = settleHeldFlowSignals(held, () => null, 1_500)
    expect(early.particles).toEqual([])
    expect(early.held).toHaveLength(1)
    const late = settleHeldFlowSignals(early.held, () => route, 1_800)
    expect(late.particles).toEqual([{ id: 's1', tone: 'delegate', ...route }])
    expect(late.held).toEqual([])
  })

  it('drops a signal whose node never appears, and never flies one past its time', () => {
    const held = holdFlowSignal([], signal, 1_000)
    expect(settleHeldFlowSignals(held, () => null, 1_000 + FLOW_HOLD_MS + 1).held).toEqual([])
    expect(settleHeldFlowSignals(held, () => route, 1_000 + FLOW_HOLD_MS + 1).particles).toEqual([])
  })
})
