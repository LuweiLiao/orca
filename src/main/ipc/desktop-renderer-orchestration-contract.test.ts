import { describe, expect, it } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import { desktopRendererOrchestrationContract } from './desktop-renderer-orchestration-contract'

describe('desktopRendererOrchestrationContract', () => {
  it('vouches for the renderer only on the orchestration calls it makes', () => {
    expect(desktopRendererOrchestrationContract('orchestration.workerStop')).toEqual({
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION
    })
    expect(desktopRendererOrchestrationContract('orchestration.workerStart')).toEqual({})
    expect(desktopRendererOrchestrationContract('status.get')).toEqual({})
  })
})
