// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { useContext } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetLocalImageSrcStateForTests } from '@/components/editor/useLocalImageSrc'
import { useAppStore } from '@/store'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatImageGallery } from './NativeChatImageGallery'
import { NativeChatImageAttachments } from './NativeChatTranscriptChrome'
import { NativeChatMarkdownImageOwnerContext } from './native-chat-markdown-image-owner'
import { NativeChatImageGalleryContext } from './native-chat-image-gallery-context'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/runtime/runtime-file-read-client', () => ({ readRuntimeFilePreview: mocks.read }))

function OpenMiddle(): React.JSX.Element {
  const open = useContext(NativeChatImageGalleryContext)
  return (
    <button onClick={() => open?.({ source: '/remote/middle.png', messageId: 'middle' })}>
      Open middle
    </button>
  )
}

const owner = {
  sessionId: 'claude_gallery',
  isVisible: true,
  fileLinkContext: { worktreeId: 'wt', worktreePath: '/remote', runtimeEnvironmentId: 'remote' },
  runtimeContext: {
    target: { kind: 'environment' as const, environmentId: 'remote' },
    worktreeId: 'wt',
    worktreePath: '/remote'
  }
}
const messages: NativeChatMessage[] = [
  {
    id: 'first',
    role: 'user',
    source: 'transcript',
    timestamp: null,
    blocks: [{ type: 'image-ref', path: '/remote/first.png', alt: 'First' }]
  },
  {
    id: 'middle',
    role: 'assistant',
    source: 'transcript',
    timestamp: null,
    blocks: [{ type: 'text', text: '![Middle](/remote/middle.png)' }]
  },
  {
    id: 'last',
    role: 'assistant',
    source: 'transcript',
    timestamp: null,
    blocks: [{ type: 'image-ref', path: '/remote/last.png' }]
  }
]

beforeEach(() => {
  resetLocalImageSrcStateForTests()
  useAppStore.setState(useAppStore.getInitialState())
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gallery')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  mocks.read.mockResolvedValue({ content: 'AA==', isBinary: true, mimeType: 'image/png' })
})
afterEach(() => {
  cleanup()
  resetLocalImageSrcStateForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('reads relative thumbnails and gallery images from the same remote session directory', async () => {
  const blocks = [{ type: 'image-ref' as const, path: 'figs/result.png' }]
  render(
    <TooltipProvider>
      <NativeChatMarkdownImageOwnerContext.Provider value={owner}>
        <NativeChatImageGallery messages={[{ ...messages[0], blocks }]} isVisible>
          <NativeChatImageAttachments blocks={blocks} runtimeContext={owner.runtimeContext} />
        </NativeChatImageGallery>
      </NativeChatMarkdownImageOwnerContext.Provider>
    </TooltipProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'View image: result.png' }))
  await screen.findByRole('dialog', { name: 'result.png' })
  await waitFor(() => expect(mocks.read).toHaveBeenCalled())
  for (const call of mocks.read.mock.calls) {
    expect(call).toEqual([
      expect.objectContaining({ target: owner.runtimeContext.target }),
      '/remote/figs/result.png',
      { kind: 'chat-image' }
    ])
  }
})

it('navigates unmounted transcript images on the owning remote host and closes with its chat', async () => {
  const view = (isVisible: boolean) => (
    <TooltipProvider>
      <NativeChatMarkdownImageOwnerContext.Provider value={owner}>
        <NativeChatImageGallery messages={messages} isVisible={isVisible}>
          <OpenMiddle />
        </NativeChatImageGallery>
      </NativeChatMarkdownImageOwnerContext.Provider>
    </TooltipProvider>
  )
  const { rerender } = render(view(true))
  expect(mocks.read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Open middle' }))
  const dialog = await screen.findByRole('dialog', { name: 'Middle' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Previous image' }))
  await screen.findByRole('dialog', { name: 'First' })
  await waitFor(() =>
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ target: owner.runtimeContext.target }),
      '/remote/first.png',
      { kind: 'chat-image' }
    )
  )
  expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled()
  fireEvent.keyDown(dialog, { key: 'ArrowRight' })
  fireEvent.keyDown(dialog, { key: 'ArrowRight' })
  await screen.findByRole('dialog', { name: 'last.png' })
  await waitFor(() =>
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ target: owner.runtimeContext.target }),
      '/remote/last.png',
      { kind: 'chat-image' }
    )
  )
  expect(within(dialog).getByRole('button', { name: 'Next image' })).toBeDisabled()
  rerender(view(false))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
