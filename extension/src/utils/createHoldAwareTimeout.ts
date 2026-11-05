/** A timeout that stops counting while a learner holds a pause, see {@link createHoldAwareTimeout}. */
export interface HoldAwareTimeout {
  /** Aborts with a `TimeoutError` once the unheld time passed. */
  readonly signal: AbortSignal
  /** Stops the clock (a declared pause is held); a second call while held does nothing. */
  hold(): void
  /** Starts the clock again with the time that was left when it stopped. */
  release(): void
  /** Ends the timer without aborting the signal. */
  dispose(): void
}

/**
 * Makes an abort signal that fires after a number of milliseconds of time in which no pause was held.
 *
 * Why it exists: Codebook's own readiness request is bounded by `REPOSITORY_SETUP_TIMEOUT_MS`, but a module-evaluation pause in that very request stays held for as long as the learner reads, so the bound must not run meanwhile (Cycle 0086, decision R5). Called by {@link ConfiguredBrowserRun} for the preparation window of a Next run and handed to the launcher through the readiness observer.
 * @param milliseconds - The unheld time after which the signal aborts.
 * @param now - The clock; `performance.now` by default.
 * @returns The signal and the hold controls.
 * @example
 * ```ts
 * const timeout = createHoldAwareTimeout(90_000)
 * timeout.hold() // 100 s pass, the signal stays quiet
 * timeout.release() // 90 s of unheld time left
 * ```
 */
export function createHoldAwareTimeout(
  milliseconds: number,
  now: () => number = () => performance.now(),
): HoldAwareTimeout {
  const controller = new AbortController()
  let remainingMs = milliseconds
  let startedAtMs = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let isHeld = false
  const start = (): void => {
    startedAtMs = now()
    timer = setTimeout(() => {
      timer = undefined
      const error = new Error('The operation timed out.')
      error.name = 'TimeoutError'
      controller.abort(error)
    }, remainingMs)
  }
  start()
  return {
    signal: controller.signal,
    hold(): void {
      if (isHeld) return
      isHeld = true
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
      remainingMs = Math.max(1, remainingMs - (now() - startedAtMs))
    },
    release(): void {
      if (!isHeld) return
      isHeld = false
      if (!controller.signal.aborted) start()
    },
    dispose(): void {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
