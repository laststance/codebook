import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { waitTimeoutText } from '../runtimeSupport/utils/waitTimeoutText'

/**
 * The timer API a deadline reads, so a test drives time by hand where the product uses the real clock.
 * `set` starts a one-shot timer and returns the function that cancels it.
 */
export interface DeadlineTimers {
  set(callback: () => void, delayMs: number): () => void
}

/** The real clock: Node's `setTimeout`, which {@link StudyWorkspace} uses unless a test injects another. */
export const REAL_DEADLINE_TIMERS: DeadlineTimers = {
  set: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    return (): void => clearTimeout(handle)
  },
}

/** One running deadline: {@link signal} aborts when it passes; {@link cancel} ends the timer once the bounded work is over. */
export interface SlotDeadline {
  readonly signal: AbortSignal
  /** Whether the deadline has passed. */
  readonly expired: () => boolean
  cancel(): void
  /**
   * Races a piece of work against this deadline.
   * @param work - The work; it keeps running after a loss, and its later outcome is for the caller to clean up.
   * @param what - What is waited for, named in the timeout; the deadline's own description when omitted.
   * @returns What `work` returns when it ends first.
   * @throws {@link WaitTimeoutError} when the deadline passes first; `work`'s own failure when it ends first.
   */
  within<Value>(work: Promise<Value>, what?: string): Promise<Value>
}

/**
 * Starts one deadline over several steps of work, so a recorded-source slot's open, show and text wait, and the close of the earlier tab, share a single bound instead of each waiting on its own.
 * Called by {@link StudyWorkspace.showNodeSourceSlot} once per slot show.
 * @param delayMs - The bound, from now.
 * @param description - What is waited for, named in the timeout ({@link waitTimeoutText}).
 * @param timers - The clock; {@link REAL_DEADLINE_TIMERS} in the product.
 * @returns The running deadline.
 * @example
 * const deadline = startSlotDeadline(5_000, 'the recorded source', REAL_DEADLINE_TIMERS)
 * try { await deadline.within(openAndShow()) } finally { deadline.cancel() }
 */
export function startSlotDeadline(
  delayMs: number,
  description: string,
  timers: DeadlineTimers,
): SlotDeadline {
  const controller = new AbortController()
  let passed = false
  let lapse: () => void = () => undefined
  const lapsed = new Promise<void>((resolve) => {
    lapse = resolve
  })
  const cancelTimer = timers.set(() => {
    passed = true
    controller.abort(new WaitTimeoutError(waitTimeoutText(description)))
    lapse()
  }, delayMs)
  return {
    signal: controller.signal,
    expired: () => passed,
    cancel: cancelTimer,
    within: (work, what = description) => {
      // The lost work's own failure is the caller's to clean up, not an unhandled rejection.
      work.catch(() => undefined)
      return Promise.race([
        work,
        lapsed.then((): never => {
          throw new WaitTimeoutError(waitTimeoutText(what))
        }),
      ])
    },
  }
}
