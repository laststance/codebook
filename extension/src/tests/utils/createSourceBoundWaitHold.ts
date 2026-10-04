import { SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION } from '../../constants'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

/** How many event-loop turns a held wait looks when no abort signal can end it; then it ends as its own bound would. */
const HELD_WAIT_TURN_LIMIT = 10_000

/**
 * Keeps a run's wait for an accepted stop's own pause open instead of ending it after 3 s of real time, so a test can tell a pause admitted at once from one adopted when that wait ends. Both runtime harnesses route the run's `waitUntil` through it and expose `hold` as their `holdSourceBoundWait` control.
 * @param turnLimit - How many turns a held wait without an abort signal looks before it times out; a wait with a signal looks until the pause is there or the run is cancelled.
 * @returns `hold` (the test's control; its `release` ends the held wait as its 3 s bound would, for a test that acts while the wait is open and then lets it expire), `holds` (whether a wait of this description is held) and `wait` (the held wait itself).
 * @example
 * const sourceBoundWait = createSourceBoundWaitHold()
 * const held = sourceBoundWait.hold()
 * if (sourceBoundWait.holds(description)) return sourceBoundWait.wait(read, description, signal)
 * held.release() // the wait times out after its current look
 */
export function createSourceBoundWaitHold(turnLimit = HELD_WAIT_TURN_LIMIT) {
  let isHeld = false,
    isReleased = false
  return {
    hold(): { release(): void } {
      isHeld = true
      isReleased = false
      return {
        release(): void {
          isReleased = true
        },
      }
    },
    holds(description: string): boolean {
      return isHeld && description === SOURCE_BOUND_PAUSE_WAIT_DESCRIPTION
    },
    async wait<Value>(
      read: () => Value | Promise<Value>,
      description: string,
      signal?: AbortSignal,
    ): Promise<NonNullable<Value>> {
      // Without a signal nothing can cancel the wait, so it ends at the turn limit instead of spinning.
      for (let turn = 0; signal || turn < turnLimit; turn++) {
        signal?.throwIfAborted()
        const value = await read()
        // The real wait refuses a read that ended after the run was cancelled, also a truthy one.
        signal?.throwIfAborted()
        if (value) return value
        // The test released the hold: the wait ends as its own bound would.
        if (isReleased) break
        await new Promise<void>((resolve) => {
          setImmediate(resolve)
        })
      }
      return waitUntil(read, description, 0, signal)
    },
  }
}
