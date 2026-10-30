import type { FlowSignal, FlowSignalTone } from './project-flow-signal'

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

export const FLOW_HOLD_MS = 2_000
const MAX_HELD_SIGNALS = 32

export type HeldFlowSignal = { signal: FlowSignal; expiresAt: number }

/** A signal can name a node the layout has not drawn yet; it waits a moment, then is dropped. */
export function holdFlowSignal(
  held: readonly HeldFlowSignal[],
  signal: FlowSignal,
  now: number
): readonly HeldFlowSignal[] {
  return [...held, { signal, expiresAt: now + FLOW_HOLD_MS }].slice(-MAX_HELD_SIGNALS)
}

export function settleHeldFlowSignals(
  held: readonly HeldFlowSignal[],
  resolve: (signal: FlowSignal) => FlowRoute | null,
  now: number
): { particles: FlowParticle[]; held: HeldFlowSignal[] } {
  const particles: FlowParticle[] = []
  const stillHeld: HeldFlowSignal[] = []
  for (const entry of held) {
    const route = entry.expiresAt > now ? resolve(entry.signal) : null
    if (route) {
      particles.push({ id: entry.signal.id, tone: entry.signal.tone, ...route })
    } else if (entry.expiresAt > now) {
      stillHeld.push(entry)
    }
  }
  return { particles, held: stillHeld }
}
