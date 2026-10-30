import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useWindowStreamVisible } from '@/hooks/use-window-stream-visibility'
import {
  admitFlowParticle,
  FLOW_PARTICLE_MS,
  releaseFlowParticle,
  type FlowParticle,
  type FlowRoute
} from './project-flow-particles'
import type { FlowSignal, FlowSignalBus } from './project-flow-signal'
import './project-flow.css'

type Props = {
  bus: FlowSignalBus
  /** Where a signal's two nodes are joined on the surface; null when it cannot be drawn. */
  resolve: (signal: FlowSignal) => FlowRoute | null
}

// Why: a flight is display only, so a signal seen while hidden or with reduced motion is dropped.
export function ProjectFlowOverlay({ bus, resolve }: Props): React.JSX.Element | null {
  const reducedMotion = usePrefersReducedMotion()
  const windowVisible = useWindowStreamVisible(0)
  const running = windowVisible && !reducedMotion
  const [particles, setParticles] = useState<readonly FlowParticle[]>([])
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve

  useEffect(() => {
    if (!running) {
      return
    }
    const unsubscribe = bus.subscribe((signal) => {
      const route = resolveRef.current(signal)
      if (route) {
        setParticles((current) =>
          admitFlowParticle(current, { id: signal.id, tone: signal.tone, ...route })
        )
      }
    })
    return () => {
      unsubscribe()
      setParticles([])
    }
  }, [bus, running])

  if (!running || particles.length === 0) {
    return null
  }
  return (
    <div aria-hidden data-project-flow-layer="" className="project-flow-layer">
      {particles.map((particle) => (
        <ProjectFlowParticle
          key={particle.id}
          particle={particle}
          onDone={() => setParticles((current) => releaseFlowParticle(current, particle.id))}
        />
      ))}
    </div>
  )
}

function ProjectFlowParticle({
  particle,
  onDone
}: {
  particle: FlowParticle
  onDone: () => void
}): React.JSX.Element {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    // Why: animationend does not fire in a window that stopped painting, and the dot must go.
    const timer = window.setTimeout(() => onDoneRef.current(), FLOW_PARTICLE_MS + 150)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <span
      data-project-flow-particle=""
      data-tone={particle.tone}
      data-reverse={particle.reverse || undefined}
      className="project-flow-particle"
      style={{
        offsetPath: `path("${particle.path}")`,
        animationDuration: `${FLOW_PARTICLE_MS}ms`
      }}
      onAnimationEnd={() => onDone()}
    />
  )
}
