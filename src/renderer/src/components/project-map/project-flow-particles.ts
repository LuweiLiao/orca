import type { FlowSignalTone } from './project-flow-signal'

export const FLOW_PARTICLE_MS = 900
export const MAX_FLOW_PARTICLES = 24

export type FlowRoute = {
  path: string
  /** The signal runs against the drawn wire, so the particle starts at its end. */
  reverse: boolean
}

export type FlowParticle = FlowRoute & {
  id: string
  tone: FlowSignalTone
}

/** Adds a flight unless that signal is already in the air; the oldest gives way past the cap. */
export function admitFlowParticle(
  current: readonly FlowParticle[],
  next: FlowParticle,
  max = MAX_FLOW_PARTICLES
): readonly FlowParticle[] {
  if (current.some((particle) => particle.id === next.id)) {
    return current
  }
  const kept = current.length >= max ? current.slice(current.length - max + 1) : current
  return [...kept, next]
}

export function releaseFlowParticle(
  current: readonly FlowParticle[],
  id: string
): readonly FlowParticle[] {
  return current.some((particle) => particle.id === id)
    ? current.filter((particle) => particle.id !== id)
    : current
}
