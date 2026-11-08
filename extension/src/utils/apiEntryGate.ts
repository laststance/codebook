import { NODE_TEST_ATTACH_TIMEOUT_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

/**
 * The entry gate of the app's own API server (E-3, D21): holds the `--inspect-brk` entry pause of the API's debug sessions from before the editor attaches until the run released it once, so the entry pause is never taken for a stop and never lost.
 *
 * Why it exists: the API's entry `stopped` arrives before its session is a participant (the run drops such events) and an idle pause is nobody's stop, so without the gate the entry pause would either fail the run or never be continued. The run buffers it here, selects and verifies the session, subscribes its inspector channel, and only then sends DAP `continue` exactly once.
 * Called by the run's `onEvent` (capture) and by its API attach step (wait and release).
 * @example
 * ```ts
 * const gate = new ApiEntryGate()
 * gate.capture('child', 1) // true: held
 * await gate.release('child', (threadId) => session.customRequest('continue', { threadId }), signal)
 * gate.capture('child', 2) // false: a real stop now flows to the run
 * ```
 */
export class ApiEntryGate {
  private readonly stops = new Map<string, number>()
  private released = false
  private cancelled = false
  private releases = 0

  /**
   * Holds a `stopped` event of a gated session while the gate is closed.
   * @param sessionId - The session that stopped.
   * @param threadId - The paused thread; an event without a valid thread is held but cannot be continued.
   * @returns `true` while the gate is closed (the event is the entry pause and the run must ignore it); `false` once the entry was released.
   * @example gate.capture('child', 1) // => true
   */
  capture(sessionId: string, threadId: number | undefined): boolean {
    if (this.released) return false
    if (Number.isInteger(threadId)) this.stops.set(sessionId, threadId!)
    return true
  }

  /**
   * Continues the entry pause of one session exactly once, after waiting for it when it has not arrived yet.
   * Called by the run once the session is selected, verified and its inspector channel subscribed.
   * @param sessionId - The selected API session.
   * @param send - Sends DAP `continue` for the thread.
   * @param signal - Cancels the wait.
   * @throws When no entry pause arrives within {@link NODE_TEST_ATTACH_TIMEOUT_MS}, or when `send` fails.
   * @example await gate.release('child', (threadId) => continueThread(threadId), signal)
   */
  async release(
    sessionId: string,
    send: (threadId: number) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.released || this.cancelled) return
    const threadId = await waitUntil(
      () => this.stops.get(sessionId),
      'the entry pause of the API server',
      NODE_TEST_ATTACH_TIMEOUT_MS,
      signal,
    )
    // A cancel while the wait ran leaves the process paused for its kill; nothing is continued.
    if (this.released || this.cancelled) return
    this.released = true
    this.releases++
    await send(threadId)
  }

  /** Closes the gate for good: a cancelled run never continues the entry pause. @example gate.cancel() */
  cancel(): void {
    this.cancelled = true
  }

  /** How many times the entry pause was continued; the contract is at most one. @example gate.releaseCount // => 1 */
  get releaseCount(): number {
    return this.releases
  }

  /** Tells whether the entry pause has been continued. @example gate.isReleased // => false before release */
  get isReleased(): boolean {
    return this.released
  }
}
