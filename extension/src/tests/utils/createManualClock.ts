/**
 * A clock a test moves by hand, for the timers of a run under test: both runtime harnesses hand its `setTimeout` and `clearTimeout` to the run and its `advance` to the test.
 * @returns The timer functions, `now` (the clock's time in milliseconds, which the run reads as `performance.now` to measure how long it held a pause) and `advance`, which fires every timer due by the new time in the order they fall due (the earlier one first, equal times in the order they were set) and never a timer that an earlier callback of the same advance cleared.
 * @example
 * const clock = createManualClock()
 * clock.setTimeout(() => fired.push('deadline'), 20_000)
 * clock.advance(20_000) // fired: ['deadline']
 */
export function createManualClock(): {
  setTimeout(callback: () => void, delayMs: number): number
  clearTimeout(id: number): void
  advance(milliseconds: number): void
  now(): number
} {
  const timers = new Map<number, { at: number; callback: () => void }>()
  let nowMs = 0,
    lastTimerId = 0
  /** Finds the timer that falls due first by the current time; ids grow in the order timers were set. */
  const nextDueTimer = (): [number, () => void] | undefined => {
    let next: [number, { at: number; callback: () => void }] | undefined
    for (const entry of timers)
      if (entry[1].at <= nowMs && (!next || entry[1].at < next[1].at))
        next = entry
    return next && [next[0], next[1].callback]
  }
  return {
    setTimeout(callback, delayMs): number {
      const id = ++lastTimerId
      timers.set(id, { at: nowMs + delayMs, callback })
      return id
    },
    clearTimeout(id): void {
      timers.delete(id)
    },
    now: () => nowMs,
    advance(milliseconds): void {
      nowMs += milliseconds
      // Each callback may clear or set timers, so the due ones are read again after every one.
      for (let due = nextDueTimer(); due; due = nextDueTimer()) {
        timers.delete(due[0])
        due[1]()
      }
    },
  }
}
