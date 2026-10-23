import { waitUntil } from '../runtimeSupport/utils/waitUntil'

/** The part of the editor's workspace API {@link awaitDocumentSettled} listens to: its text document change event. */
type DocumentChangeEvent = (
  listener: (event: { document: { uri: { toString(): string } } }) => void,
) => { dispose(): void }

/**
 * Waits until a condition about one open document holds, checked at each change of that document and on a bounded poll, so a provider result that reached the document before the subscription still settles the wait.
 * Called by {@link StudyWorkspace} while a captured source view takes its new bytes and while a test replay's recorded-source slot shows a moment's bytes.
 * @param onDidChangeTextDocument - The editor's text document change event.
 * @param uri - The document whose changes wake the check.
 * @param settled - Says whether the wait is over; a throw ends the wait with that error (a superseded or closed reader).
 * @param description - What is waited for, named in the timeout.
 * @param timeoutMs - The wait's bound.
 * @param options - `signal` ends the wait through `settled`'s own check when it aborts; `afterSubscribe` runs once the change listener is in place (to notify the document's provider).
 * @returns Once `settled` answers `true`.
 * @throws What `settled` or `afterSubscribe` throws, or a timeout naming `description`.
 * @example await awaitDocumentSettled(vscode.workspace.onDidChangeTextDocument, uri.toString(), () => document.getText() === text, 'the recorded source of this moment', 1_000)
 */
export function awaitDocumentSettled(
  onDidChangeTextDocument: DocumentChangeEvent,
  uri: string,
  settled: () => boolean,
  description: string,
  timeoutMs: number,
  {
    signal,
    afterSubscribe,
  }: { signal?: AbortSignal; afterSubscribe?: () => void } = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const observation = new AbortController()
    let finished = false
    const finish = (failure?: { cause: unknown }): void => {
      if (finished) return
      finished = true
      subscription.dispose()
      observation.abort()
      signal?.removeEventListener('abort', check)
      if (failure) reject(failure.cause)
      else resolve()
    }
    const check = (): void => {
      try {
        if (settled()) finish()
      } catch (error) {
        finish({ cause: error })
      }
    }
    const subscription = onDidChangeTextDocument((event) => {
      // Another document's edit cannot settle this one.
      if (event.document.uri.toString() === uri) check()
    })
    signal?.addEventListener('abort', check, { once: true })
    // Close and newer intent may emit no document event; the bounded poll observes them.
    void waitUntil(
      () => {
        check()
        return finished
      },
      description,
      timeoutMs,
      observation.signal,
    ).catch((error: unknown) => finish({ cause: error }))
    // A throw ends the wait with that error and releases the listener and the poll, like any other exit.
    try {
      afterSubscribe?.()
    } catch (error) {
      finish({ cause: error })
      return
    }
    check()
  })
}
