import * as pdfjsLib from 'pdfjs-dist'
import { buildPdfJsDocumentOptions } from './pdf-js-document-options'

type PdfLoadingTask = ReturnType<typeof pdfjsLib.getDocument>

export type PdfDocumentLoader = {
  load: (content: string) => void
  dispose: () => void
}

/**
 * What the viewer shows for a load that failed: with nothing on screen it replaces the view; with
 * an earlier version still on screen it is a notice above that version (`stale`), so a LaTeX
 * build caught half-written never blanks what the reader had.
 */
export type PdfLoadError = { message: string; stale: boolean }

export function createPdfDocumentLoader({
  display,
  onError
}: {
  display: (doc: pdfjsLib.PDFDocumentProxy) => () => void
  onError: (error: PdfLoadError | null) => void
}): PdfDocumentLoader {
  const tasks = new Set<PdfLoadingTask>()
  let pending: PdfLoadingTask | null = null
  let displayed: { task: PdfLoadingTask; detach: () => void } | null = null
  let disposed = false

  const destroy = (task: PdfLoadingTask): void => {
    if (tasks.delete(task)) {
      void task.destroy().catch(() => {})
    }
  }
  const report = (message: string): void => {
    onError({ message, stale: displayed !== null })
  }
  const fail = (error: unknown): void => {
    report(
      error instanceof Error && error.name === 'PasswordException'
        ? 'This PDF is password-protected'
        : 'Failed to load PDF preview'
    )
  }
  const detachDisplayed = (): void => {
    const previous = displayed
    displayed = null
    try {
      // Why: flush the reader's position before the replacement restores it.
      previous?.detach()
    } finally {
      if (previous) {
        destroy(previous.task)
      }
    }
  }

  return {
    load: (content) => {
      if (disposed) {
        return
      }
      if (pending) {
        destroy(pending)
        pending = null
      }
      // Why: the version on screen stays until a replacement parses, so the reader keeps reading.
      if (!content) {
        report('Failed to load PDF preview')
        return
      }
      let binary: string
      try {
        binary = window.atob(content)
      } catch {
        report('Failed to decode PDF content')
        return
      }
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      let task: PdfLoadingTask
      try {
        task = pdfjsLib.getDocument(buildPdfJsDocumentOptions(bytes, document.baseURI))
      } catch (error) {
        fail(error)
        return
      }
      tasks.add(task)
      pending = task
      void task.promise.then(
        (doc) => {
          if (disposed || pending !== task) {
            return
          }
          pending = null
          detachDisplayed()
          try {
            displayed = { task, detach: display(doc) }
            onError(null)
          } catch (error) {
            destroy(task)
            fail(error)
          }
        },
        (error: unknown) => {
          if (disposed || pending !== task) {
            return
          }
          pending = null
          destroy(task)
          fail(error)
        }
      )
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      pending = null
      try {
        displayed?.detach()
      } finally {
        displayed = null
        for (const task of tasks) {
          destroy(task)
        }
      }
    }
  }
}
