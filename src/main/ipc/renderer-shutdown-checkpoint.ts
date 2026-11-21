import { ipcMain } from 'electron'
import type {
  RendererShutdownCapture,
  RendererShutdownCheckpointService,
  ShutdownCheckpointResult
} from '../core-desktop/renderer-shutdown-checkpoint-service'

export function registerRendererShutdownCheckpointHandler(
  checkpoints: RendererShutdownCheckpointService
): void {
  // beforeunload cannot await; sync reply confirms staging while navigation paths separately join durability.
  let pendingCheckpoint: Promise<ShutdownCheckpointResult> = Promise.resolve({ ok: true })
  // Each native desktop window awaits its own checkpoint, not a sibling window's later one.
  const rendererCheckpoints = new WeakMap<object, Promise<ShutdownCheckpointResult>>()

  ipcMain.on('app:stage-before-unload-sync', (event, args: RendererShutdownCapture) => {
    const result = checkpoints.stage(args, event.sender)
    pendingCheckpoint = result.durable
    if (event.sender) {
      rendererCheckpoints.set(event.sender, pendingCheckpoint)
    }
    event.returnValue = result.staged
  })

  ipcMain.handle('app:await-before-unload-checkpoint', (event): Promise<ShutdownCheckpointResult> =>
    event?.sender
      ? (rendererCheckpoints.get(event.sender) ?? Promise.resolve({ ok: true }))
      : pendingCheckpoint
  )
}
