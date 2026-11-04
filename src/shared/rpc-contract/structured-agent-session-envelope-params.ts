import { z } from 'zod'
import { Identifier, SessionId } from './structured-agent-session-identifiers'

export const MutationEnvelope = z
  .object({
    sessionId: SessionId,
    clientOperationId: Identifier('Invalid client operation id'),
    expectedRuntimeFence: z.number().int().positive().nullable(),
    payloadFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'Payload fingerprint must be a sha256 hex digest')
  })
  .strict()
