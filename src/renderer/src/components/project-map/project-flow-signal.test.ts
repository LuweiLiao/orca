import { describe, expect, it } from 'vitest'
import { createFlowSignalBus, type FlowSignal } from './project-flow-signal'
import { resolveFlowRoute, type FlowWire } from './project-flow-wire-route'

const signal = (id: string): FlowSignal => ({ id, from: 'a', to: 'b', tone: 'delegate' })

describe('createFlowSignalBus', () => {
  it('flies one occurrence once however many times it is told', () => {
    let clock = 0
    const bus = createFlowSignalBus(() => clock)
    const seen: string[] = []
    bus.subscribe((entry) => seen.push(entry.id))
    bus.publish(signal('d1:completed'))
    bus.publish(signal('d1:completed'))
    clock += 11_000
    bus.publish(signal('d1:completed'))
    bus.publish(signal('d2:completed'))
    expect(seen).toEqual(['d1:completed', 'd1:completed', 'd2:completed'])
  })

  it('drops what nobody is listening for', () => {
    const bus = createFlowSignalBus()
    bus.publish(signal('x'))
    const seen: string[] = []
    bus.subscribe((entry) => seen.push(entry.id))
    expect(seen).toEqual([])
  })
})

describe('resolveFlowRoute for a hand-off', () => {
  const wires: FlowWire[] = [
    { kind: 'delegate', from: 'a', to: 'b', path: 'delegate' },
    { kind: 'handoff', from: 'a', to: 'b', path: 'handoff' }
  ]

  it('rides the hand-off wire when one joins the two, the delegation wire otherwise', () => {
    expect(resolveFlowRoute(wires, 'a', 'b', { handoff: true })?.path).toBe('handoff')
    expect(resolveFlowRoute(wires, 'a', 'b')?.path).toBe('delegate')
    expect(resolveFlowRoute(wires.slice(0, 1), 'a', 'b', { handoff: true })?.path).toBe('delegate')
  })
})
