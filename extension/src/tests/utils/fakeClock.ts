import type { TestContext } from 'node:test'

/** How far one step moves the faked clock; short enough that 250 ms test tolerances stay meaningful. */
const FAKE_CLOCK_STEP_MS = 50

/** Real event-loop turns {@link advanceClockUntil} grants before each fake step, so real work costs little fake time. */
const REAL_TURNS_PER_STEP = 5

/** The real timer, kept from before any test fakes `setTimeout`, so real storage and promise work can finish between fake steps. */
const realSetTimeout = setTimeout

/** Fake time each test's clock has been moved forward, added to `performance.now()` while the clock is faked. */
const advancedMs = new WeakMap<TestContext, number>()

/** Restores the real `performance.now()` of each test whose clock is faked. */
const restoreNow = new WeakMap<TestContext, () => void>()

/** Lets pending real work (file reads, promise chains) run for one event-loop turn while `setTimeout` is faked. @example await realTurn() */
function realTurn(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 1))
}

/** Moves both faked clocks one step: `performance.now()` first, so a timer that fires already reads the later time. @example step(context, 50) */
function step(context: TestContext, durationMs: number): void {
  advancedMs.set(context, (advancedMs.get(context) ?? 0) + durationMs)
  context.mock.timers.tick(durationMs)
}

/**
 * Fakes `setTimeout` and `performance.now()` for one test, so bounds of several seconds pass without real waiting.
 *
 * Both are needed: timers hold the bounds, and polling waits such as {@link waitUntil} read their deadline from `performance.now()`.
 * Call it after the arrangement that needs real timers, and {@link resetFakeClock} before real waits resume.
 *
 * @param context - The running test's context.
 * @example
 * enableFakeClock(context)
 * await advanceClock(context, 4_000) // four fake seconds, a few real milliseconds
 * resetFakeClock(context)
 */
export function enableFakeClock(context: TestContext): void {
  if (advancedMs.has(context)) return
  advancedMs.set(context, 0)
  const realNow = performance.now.bind(performance)
  const fakedNow = context.mock.method(
    performance,
    'now',
    () => realNow() + (advancedMs.get(context) ?? 0),
  )
  restoreNow.set(context, () => fakedNow.mock.restore())
  context.mock.timers.enable({ apis: ['setTimeout'] })
}

/** Returns one test to the real `setTimeout` and `performance.now()`; safe to call when the clock was never faked. @example resetFakeClock(context) */
export function resetFakeClock(context: TestContext): void {
  if (!advancedMs.has(context)) return
  advancedMs.delete(context)
  context.mock.timers.reset()
  restoreNow.get(context)?.()
  restoreNow.delete(context)
}

/**
 * Moves a test's faked clock forward by an exact amount; real work gets an event-loop turn before every step.
 *
 * @param context - The test whose clock {@link enableFakeClock} faked.
 * @param durationMs - Fake time to pass.
 * @example await advanceClock(context, 4_000)
 */
export async function advanceClock(
  context: TestContext,
  durationMs: number,
): Promise<void> {
  for (
    let elapsedMs = 0;
    elapsedMs < durationMs;
    elapsedMs += FAKE_CLOCK_STEP_MS
  ) {
    await realTurn()
    step(context, Math.min(FAKE_CLOCK_STEP_MS, durationMs - elapsedMs))
  }
  await realTurn()
}

/**
 * Moves the faked clock forward until a condition holds, and reports how much fake time that took.
 *
 * @param context - The test whose clock {@link enableFakeClock} faked.
 * @param reached - The awaited condition, read after every real event-loop turn.
 * @param limitMs - Fake time after which the wait gives up.
 * @returns Fake milliseconds until the condition held, or `undefined` when it still did not at `limitMs`.
 * @example
 * await advanceClockUntil(context, () => controller.state().readiness === 'failed', 6_000) // => 5_000
 */
export async function advanceClockUntil(
  context: TestContext,
  reached: () => boolean,
  limitMs: number,
): Promise<number | undefined> {
  for (
    let elapsedMs = 0;
    elapsedMs <= limitMs;
    elapsedMs += FAKE_CLOCK_STEP_MS
  ) {
    // Real work that needs no fake time finishes here without consuming any.
    for (let turn = 0; turn < REAL_TURNS_PER_STEP; turn++) {
      await realTurn()
      if (reached()) return elapsedMs
    }
    step(context, FAKE_CLOCK_STEP_MS)
  }
  await realTurn()
  return reached() ? limitMs : undefined
}

/**
 * Moves the faked clock forward until an operation settles, and reports how much fake time that took.
 *
 * @param context - The test whose clock {@link enableFakeClock} faked.
 * @param operation - The awaited work; its rejection is the caller's to observe.
 * @param limitMs - Fake time after which the wait gives up.
 * @returns Fake milliseconds until the operation settled.
 * @throws When the operation is still pending at `limitMs`, so a regression fails the test instead of hanging it on a clock nothing advances.
 * @example
 * const elapsedMs = await advanceClockUntilSettled(context, navigation, 6_500) // => 5_000
 */
export async function advanceClockUntilSettled(
  context: TestContext,
  operation: Promise<unknown>,
  limitMs: number,
): Promise<number> {
  let settled = false
  const mark = (): void => {
    settled = true
  }
  operation.then(mark, mark)
  const elapsedMs = await advanceClockUntil(context, () => settled, limitMs)
  if (elapsedMs === undefined)
    throw new Error(`Still pending after ${limitMs} ms of faked time.`)
  return elapsedMs
}
