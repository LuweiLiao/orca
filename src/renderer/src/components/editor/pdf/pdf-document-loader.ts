import * as pdfjsLib from 'pdfjs-dist'
import { buildPdfJsDocumentOptions } from './pdf-js-document-options'
import { createOrcaMediaRangeTransport } from './pdf-orca-media-range-transport'
import { translate } from '@/i18n/i18n'

type PdfLoadingTask = ReturnType<typeof pdfjsLib.getDocument>

/** Bytes (raw or base64), or an orca-media URL (with its size) pdf.js reads by range. */
export type PdfDocumentSource =
  | { bytes: Uint8Array }
  | { base64: string }
  | { url: string; length?: number }

export type PdfDocumentLoader = {
  load: (source: PdfDocumentSource) => void
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
  /** Its detach may return a promise; the document stays alive until it settles. */
  display: (doc: pdfjsLib.PDFDocumentProxy) => () => Promise<void> | void
  onError: (error: PdfLoadError | null) => void
}): PdfDocumentLoader {
  const tasks = new Set<PdfLoadingTask>()
  let pending: PdfLoadingTask | null = null
  let displayed: { task: PdfLoadingTask; detach: () => Promise<void> | void } | null = null
  let disposed = false

  const destroy = (task: PdfLoadingTask, after?: Promise<void> | void): void => {
    if (tasks.delete(task)) {
      void Promise.resolve(after)
        .catch(() => {})
        .then(() => task.destroy())
        .catch(() => {})
    }
  }
  const report = (message: string): void => {
    onError({ message, stale: displayed !== null })
  }
  const fail = (error: unknown): void => {
    report(
      error instanceof Error && error.name === 'PasswordException'
        ? translate(
            'auto.components.editor.PdfViewer.passwordProtected',
            'This PDF is password-protected'
          )
        : pdfLoadFailedMessage()
    )
  }

  const detachDisplayed = (): void => {
    const previous = displayed
    displayed = null
    let detached: Promise<void> | void = undefined
    try {
      // Why: flush the reader's position before the replacement restores it.
      detached = previous?.detach()
    } finally {
      if (previous) {
        destroy(previous.task, detached)
      }
    }
  }

  return {
    load: (source) => {
      if (disposed) {
        return
      }
      if (pending) {
        destroy(pending)
        pending = null
      }
      // Why: the version on screen stays until a replacement parses, so the reader keeps reading.
      // Bound to the task once it exists: a failed range tears down that load, not just its message.
      let failRange: (error: unknown) => void = fail
      const documentSource =
        'url' in source
          ? source.length
            ? {
                range: createOrcaMediaRangeTransport(source.url, source.length, (error) =>
                  failRange(error)
                )
              }
            : // orca-media refuses fetch, so a URL is only readable through its sized range transport.
              pdfLoadFailedMessage()
          : 'bytes' in source
            ? // pdf.js transfers the buffer to its worker; the caller keeps its own copy.
              { data: source.bytes.slice() }
            : decodePdfBase64(source.base64)
      if (typeof documentSource === 'string') {
        report(documentSource)
        return
      }
      let task: PdfLoadingTask
      try {
        task = pdfjsLib.getDocument(buildPdfJsDocumentOptions(documentSource, document.baseURI))
      } catch (error) {
        fail(error)
        return
      }
      tasks.add(task)
      pending = task
      failRange = (error) => {
        if (disposed || !tasks.has(task)) {
          return
        }
        if (pending === task) {
          pending = null
        }
        const shown = displayed?.task === task ? displayed : null
        try {
          // Why: the failed read also fails the detach's flush; nothing awaits that rejection.
          void Promise.resolve(shown?.detach()).catch(() => {})
        } finally {
          if (shown) {
            displayed = null
          }
          destroy(task)
          fail(error)
        }
      }
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
      const shown = displayed
      let detached: Promise<void> | void = undefined
      try {
        detached = shown?.detach()
      } finally {
        displayed = null
        for (const task of tasks) {
          destroy(task, task === shown?.task ? detached : undefined)
        }
      }
    }
  }
}

function pdfLoadFailedMessage(): string {
  return translate('auto.components.editor.PdfViewer.loadFailed', 'Failed to load PDF preview')
}

function decodePdfBase64(content: string): { data: Uint8Array } | string {
  if (!content) {
    return pdfLoadFailedMessage()
  }
  let binary: string
  try {
    binary = window.atob(content)
  } catch {
    return translate(
      'auto.components.editor.PdfViewer.decodeFailed',
      'Failed to decode PDF content'
    )
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return { data: bytes }
}
