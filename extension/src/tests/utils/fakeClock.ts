import type { TestContext } from 'node:test'

/** How far one step moves the faked clock; short enough that 250 ms test tolerances stay meaningful. */
const FAKE_CLOCK_STEP_MS = 50

/** The fewest real event-loop turns {@link advanceClockUntil} grants before each fake step, so real work that is not file work costs little fake time. */
const MIN_REAL_TURNS_PER_STEP = 5

/** Real event-loop turns one stretch of real file work may stay pending before {@link reachedWithoutFakeTime} reports it; a turn lasts at least 1 ms. */
const PENDING_FILE_WORK_TURN_LIMIT = 10_000

/** The names `process.getActiveResourcesInfo()` gives a pending real file request: a `node:fs` call with a callback, one of `node:fs/promises`, and the close of a file handle. */
const PENDING_FILE_REQUEST_TYPES = new Set([
  'FSReqCallback',
  'FSReqPromise',
  'CloseReq',
])

/** The real timer, kept from before any test fakes `setTimeout`, so real storage and promise work can finish between fake steps. */
const realSetTimeout = setTimeout

/** Fake time each test's clock has been moved forward, added to the reading `performance.now()` gave when the clock was faked. */
const advancedMs = new WeakMap<TestContext, number>()

/** Restores the real `performance.now()` of each test whose clock is faked. */
const restoreNow = new WeakMap<TestContext, () => void>()

/** Lets pending real work (file reads, promise chains) run for one event-loop turn while `setTimeout` is faked. @example await realTurn() */
function realTurn(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 1))
}

/** Tells {@link reachedWithoutFakeTime} whether a real file request (a read, a write, a stat, a close) has not answered yet. @returns `true` while one is pending; open handles and timers that outlive the wait do not count. @example hasPendingFileWork() // => true until readFile() answers */
function hasPendingFileWork(): boolean {
  return process
    .getActiveResourcesInfo()
    .some((resourceType) => PENDING_FILE_REQUEST_TYPES.has(resourceType))
}

/**
 * Gives real work its event-loop turns while the faked clock stands still, for {@link advanceClockUntil} before every fake step.
 *
 * {@link MIN_REAL_TURNS_PER_STEP} turns always pass; further turns follow for as long as a real file request is pending, so storage work costs no fake time however long it takes.
 *
 * @param reached - The awaited condition, read after every turn.
 * @returns
 * - `true` as soon as the condition holds
 * - `false` once it does not hold and no file work is pending, so only fake time can still bring it about
 * @throws When file work is still pending after {@link PENDING_FILE_WORK_TURN_LIMIT} turns, so a file request that never answers fails the test instead of hanging it.
 * @example
 * if (await reachedWithoutFakeTime(() => controller.state().readiness === 'ready')) return elapsedMs
 */
async function reachedWithoutFakeTime(
  reached: () => boolean,
): Promise<boolean> {
  for (let turn = 1; turn <= PENDING_FILE_WORK_TURN_LIMIT; turn++) {
    await realTurn()
    if (reached()) return true
    // Nothing real is left to wait for: the caller may move the faked clock.
    if (turn >= MIN_REAL_TURNS_PER_STEP && !hasPendingFileWork()) return false
  }
  throw new Error(
    `Real file work was still pending after ${PENDING_FILE_WORK_TURN_LIMIT} event-loop turns; the faked clock was not moved.`,
  )
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
 * The faked `performance.now()` answers its reading at this call plus the time the test advanced, so real time that passes afterwards never reaches a deadline.
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
  // Read once: a start time the product stored before this call stays comparable, and no later real time is added.
  const fakedAtMs = performance.now()
  const fakedNow = context.mock.method(
    performance,
    'now',
    () => fakedAtMs + (advancedMs.get(context) ?? 0),
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
 * The clock moves only while no real file work is pending and never past `limitMs`: the last step is cut to what is left of the limit.
 *
 * @param context - The test whose clock {@link enableFakeClock} faked.
 * @param reached - The awaited condition, read after every real event-loop turn.
 * @param limitMs - Fake time after which the wait gives up.
 * @returns
 * - Fake milliseconds the clock was moved until the condition held: `0` when real work alone brought it about, at most `limitMs`
 * - `undefined` when it still did not hold at `limitMs`
 * @throws When real file work stays pending for {@link PENDING_FILE_WORK_TURN_LIMIT} event-loop turns.
 * @example
 * await advanceClockUntil(context, () => controller.state().readiness === 'failed', 6_000) // => 5_000
 */
export async function advanceClockUntil(
  context: TestContext,
  reached: () => boolean,
  limitMs: number,
): Promise<number | undefined> {
  let elapsedMs = 0
  while (elapsedMs < limitMs) {
    // Real work that needs no fake time finishes here without consuming any.
    if (await reachedWithoutFakeTime(reached)) return elapsedMs
    const stepMs = Math.min(FAKE_CLOCK_STEP_MS, limitMs - elapsedMs)
    step(context, stepMs)
    elapsedMs += stepMs
  }
  // The condition is read once more after the last step, which ended exactly at the limit.
  return (await reachedWithoutFakeTime(reached)) ? elapsedMs : undefined
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
