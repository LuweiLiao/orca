import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'

// Why: the renderer is built with this host, so it speaks the current contract; only the calls it
// is meant to make carry it, and every other orchestration mutation stays fenced from it.
const RENDERER_ORCHESTRATION_METHODS: ReadonlySet<string> = new Set(['orchestration.workerStop'])

export function desktopRendererOrchestrationContract(method: string): {
  orchestrationContractVersion?: number
} {
  return RENDERER_ORCHESTRATION_METHODS.has(method)
    ? { orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION }
    : {}
}
