import { describe, expect, it } from 'vitest'
import {
  admitFlowParticle,
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
