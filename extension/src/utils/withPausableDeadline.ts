import type { ExtensionPauseState } from '../chromeExtensionDebugger'

/**
 * Bounds an operation by a deadline that only runs while no stop of the run is paused, so a click handler held at a declared stop is not mistaken for a lost answer (ER14).
 * Called by the extension action executor for each CDP request of a click step; the pause state comes from the run's debugger.
 * @param operation - The pending request.
 * @param pauseState - Tells when the deadline stops and runs again.
 * @param limitMs - The unpaused time the operation may take.
 * @param description - What is waited for, named in the timeout.
 * @returns The operation's value.
 * @throws An `Error` `Timed out waiting for <description>` after `limitMs` of unpaused time; whatever the operation rejects with.
 * @example
 * await withPausableDeadline(cdp.request('Input.insertText', { text }), debug.pauseState, 20_000, 'the text insertion')
 */
export function withPausableDeadline<Value>(
  operation: Promise<Value>,
  pauseState: Pick<ExtensionPauseState, 'isPaused' | 'onChange'>,
  limitMs: number,
  description: string,
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    let spentMs = 0
    let segmentStartMs: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopRunning = (): void => {
      if (segmentStartMs === undefined) return
      spentMs += performance.now() - segmentStartMs
      segmentStartMs = undefined
      clearTimeout(timer)
    }
    const startRunning = (): void => {
      if (segmentStartMs !== undefined || pauseState.isPaused()) return
      segmentStartMs = performance.now()
      timer = setTimeout(
        () => {
          finish()
          reject(new Error(`Timed out waiting for ${description}`))
        },
        Math.max(0, limitMs - spentMs),
      )
    }
    // Paused: the clock stops; running again: it continues with what is left.
    const stopListening = pauseState.onChange(() =>
      pauseState.isPaused() ? stopRunning() : startRunning(),
    )
    const finish = (): void => {
      stopRunning()
      stopListening()
    }
    startRunning()
    operation.then(
      (value) => {
        finish()
        resolve(value)
      },
      (error: unknown) => {
        finish()
        reject(error)
      },
    )
  })
}
