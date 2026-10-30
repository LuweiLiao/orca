import { describe, expect, it } from 'vitest'
import { resolveFlowRoute, type FlowWire } from './project-flow-wire-route'

const wire = (kind: string, from: string, to: string, extra: Partial<FlowWire> = {}): FlowWire => ({
  kind,
  from,
  to,
  path: `${kind}:${from}>${to}`,
  ...extra
})

describe('resolveFlowRoute', () => {
  it('rides the wire forwards for a delegation and backwards for a report', () => {
    const wires = [wire('delegate', 'parent', 'child')]
    expect(resolveFlowRoute(wires, 'parent', 'child')).toEqual({
      path: 'delegate:parent>child',
      reverse: false
    })
    expect(resolveFlowRoute(wires, 'child', 'parent')).toEqual({
      path: 'delegate:parent>child',
      reverse: true
    })
  })

  it('prefers the lineage wire over a reference between the same two chats', () => {
    const wires = [wire('reference', 'parent', 'child'), wire('delegate', 'parent', 'child')]
    expect(resolveFlowRoute(wires, 'parent', 'child')?.path).toBe('delegate:parent>child')
  })

  it('skips a wire that is not drawn, and unrelated or identical ends', () => {
    const hidden = wire('reference', 'a', 'b', { backward: true })
    expect(resolveFlowRoute([hidden], 'a', 'b')).toBeNull()
    expect(resolveFlowRoute([wire('delegate', 'a', 'b')], 'a', 'c')).toBeNull()
    expect(resolveFlowRoute([wire('delegate', 'a', 'a')], 'a', 'a')).toBeNull()
  })
})
