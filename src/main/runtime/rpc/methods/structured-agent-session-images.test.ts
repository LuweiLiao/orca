import '../unused-default-rpc-methods.test-fixture'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { StructuredAgentSessionImages } from '../../../native-chat/agent-session-wire/structured-agent-session-images'
import { createTrackedJournalOpener } from '../../../native-chat/agent-session-journal/journal-host-database-test-support'
import { agentSessionRecordFixture } from '../../../native-chat/agent-session-record-test-fixture'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { STRUCTURED_AGENT_SESSION_IMAGE_METHODS } from './structured-agent-session-images'
import {
  call,
  clearStructuredHostStub,
  hostStub,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'
import type { AgentSessionJournal } from '../../../native-chat/agent-session-journal/journal-store'
import type { AgentSessionRecord } from '../../../../shared/agent-session-record'

const journals = createTrackedJournalOpener()
let directory: string
let journal: AgentSessionJournal
let record: AgentSessionRecord
let images: StructuredAgentSessionImages
const sessionId = 'claude_images'

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-image-api-'))
  record = agentSessionRecordFixture({ sessionId, launchDirectory: directory })
  journal = await journals.open({
    stateDirectory: directory,
    identity: {
      sessionId,
      workspaceId: record.location.workspaceId,
      hostId: 'local',
      agent: 'claude',
      providerHandle: null
    }
  })
  images = new StructuredAgentSessionImages({
    store: { getRecord: (id) => (id === sessionId ? record : null) },
    resolveWorkspacePath: async () => directory,
    journal: async () => journal
  })
  setStructuredAgentSessionHost(Object.assign(hostStub(), { images }))
})
afterEach(async () => {
  clearStructuredHostStub()
  await journals.closeAll()
  await rm(directory, { recursive: true, force: true })
})
const rpc = (method: string, params: unknown) =>
  call(method, params, STRUCTURED_CLIENT, {}, STRUCTURED_AGENT_SESSION_IMAGE_METHODS)

it('publishes one durable image and distinguishes publication from a renderer receipt', async () => {
  await writeFile(join(directory, 'plot.png'), 'fixture bytes')
  const params = { sessionId, id: 'image-1', path: 'plot.png', alt: 'Plot' }
  const [one, two] = await Promise.all([
    rpc('agentSession.showImage', params),
    rpc('agentSession.showImage', params)
  ])
  expect(one).toMatchObject({
    ok: true,
    result: { sessionId, id: 'image-1', state: 'pending', path: join(directory, 'plot.png') }
  })
  expect(two).toMatchObject({ ok: true, result: { state: 'pending' } })
  expect(journal.snapshot().items).toHaveLength(1)
  expect(journal.snapshot().items[0].body).toMatchObject({
    kind: 'message',
    role: 'assistant',
    blocks: [
      {
        type: 'image-ref',
        path: join(directory, 'plot.png'),
        display: { id: 'image-1', state: 'pending' }
      }
    ]
  })
  expect(await rpc('agentSession.imageStatus', { sessionId, id: 'image-1' })).toMatchObject({
    result: { state: 'pending' }
  })
  expect(
    await rpc('agentSession.imageRendered', { sessionId, id: 'image-1', state: 'failed' })
  ).toMatchObject({ result: { state: 'failed' } })
  expect(
    await rpc('agentSession.imageRendered', { sessionId, id: 'image-1', state: 'loaded' })
  ).toMatchObject({ result: { state: 'loaded' } })
  expect(
    await rpc('agentSession.imageRendered', { sessionId, id: 'image-1', state: 'failed' })
  ).toMatchObject({ result: { state: 'loaded' } })
  await journals.closeAll()
  journal = await journals.open({
    stateDirectory: directory,
    identity: {
      sessionId,
      workspaceId: record.location.workspaceId,
      hostId: 'local',
      agent: 'claude',
      providerHandle: null
    }
  })
  expect(await rpc('agentSession.imageStatus', { sessionId, id: 'image-1' })).toMatchObject({
    result: { state: 'loaded' }
  })
  expect(journal.snapshot().items).toHaveLength(1)
})

it('rejects missing files, non-image paths and an id reused for another file without publishing', async () => {
  await expect(images.show({ sessionId, id: 'absent', path: 'absent.png' })).rejects.toThrow()
  await writeFile(join(directory, 'data.txt'), 'text')
  await expect(images.show({ sessionId, id: 'text', path: 'data.txt' })).rejects.toThrow(
    'image_display_not_an_image'
  )
  expect(journal.snapshot().items).toHaveLength(0)
  await writeFile(join(directory, 'one.svg'), '<svg/>')
  await writeFile(join(directory, 'two.svg'), '<svg/>')
  await images.show({ sessionId, id: 'same', path: 'one.svg' })
  await expect(images.show({ sessionId, id: 'same', path: 'two.svg' })).rejects.toThrow(
    'image_display_id_conflict'
  )
  expect(journal.snapshot().items).toHaveLength(1)
})

it('keeps another host filesystem out of the request', async () => {
  record = { ...record, location: { ...record.location, executionHostId: 'runtime:other' } }
  await expect(images.show({ sessionId, id: 'remote', path: 'plot.png' })).rejects.toThrow(
    'image_display_wrong_host'
  )
})
