import type { TestContext } from 'node:test'

/** How far one step moves the faked clock; short enough that 250 ms test tolerances stay meaningful. */
const FAKE_CLOCK_STEP_MS = 50

/** The fewest real event-loop turns {@link advanceClockUntil} grants before each fake step, so real work that is neither file work nor a child process costs little fake time. */
const MIN_REAL_TURNS_PER_STEP = 5

/** Real event-loop turns one stretch of real file or child-process work may stay pending before {@link reachedWithoutFakeTime} reports it; a turn lasts at least 1 ms. */
const PENDING_REAL_WORK_TURN_LIMIT = 10_000

/**
 * The real work that costs no fake time, by the name `process.getActiveResourcesInfo()` gives it, each with the words the limit's error says for it.
 *
 * Only these four count. Other awaited real work gets the {@link MIN_REAL_TURNS_PER_STEP} turns of a step and then costs fake time as before: a socket or a loopback HTTP request, the output pipe of a child process that has already exited (`PipeWrap`), and zlib or crypto work on the thread pool.
 * The count is taken for the whole process, not for the code under test: a child process that lives through the test keeps every wait at {@link PENDING_REAL_WORK_TURN_LIMIT}.
 */
const PENDING_REAL_WORK_TYPES = new Map([
  ['FSReqCallback', 'a node:fs call with a callback'],
  ['FSReqPromise', 'a node:fs/promises call'],
  ['CloseReq', 'a file handle being closed'],
  ['ProcessWrap', 'a child process that has not exited'],
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

/**
 * Lists for {@link reachedWithoutFakeTime} the real work that has not finished: a file request (a read, a write, a stat, a close) that has not answered, or a child process that is still running.
 * @returns The resource names of {@link PENDING_REAL_WORK_TYPES} that are active now, each once; empty when none is. Open handles, sockets and timers that outlive the wait are not listed.
 * @example pendingRealWork() // => ['FSReqPromise'] until readFile() answers
 */
function pendingRealWork(): string[] {
  return [...new Set(process.getActiveResourcesInfo())].filter((resourceType) =>
    PENDING_REAL_WORK_TYPES.has(resourceType),
  )
}

/**
 * Gives real work its event-loop turns while the faked clock stands still, for {@link advanceClockUntil} before every fake step.
 *
 * {@link MIN_REAL_TURNS_PER_STEP} turns always pass; further turns follow for as long as a real file request is pending or a child process is running, so storage work and a `git` read cost no fake time however long they take. No other real work is waited for ({@link PENDING_REAL_WORK_TYPES} names the limit).
 *
 * @param reached - The awaited condition, read after every turn.
 * @returns
 * - `true` as soon as the condition holds
 * - `false` once it does not hold and no file or child-process work is pending, so only fake time can still bring it about
 * @throws When that work is still pending after {@link PENDING_REAL_WORK_TURN_LIMIT} turns, so a file request that never answers or a child process that never exits fails the test instead of hanging it; the error names the resources that were pending at the last turn.
 * @example
 * if (await reachedWithoutFakeTime(() => controller.state().readiness === 'ready')) return elapsedMs
 */
async function reachedWithoutFakeTime(
  reached: () => boolean,
): Promise<boolean> {
  let pending: string[] = []
  for (let turn = 1; turn <= PENDING_REAL_WORK_TURN_LIMIT; turn++) {
    await realTurn()
    if (reached()) return true
    pending = pendingRealWork()
    // Nothing real is left to wait for: the caller may move the faked clock.
    if (turn >= MIN_REAL_TURNS_PER_STEP && pending.length === 0) return false
  }
  const pendingInWords = pending
    .map(
      (resourceType) =>
        `${resourceType}: ${PENDING_REAL_WORK_TYPES.get(resourceType)}`,
    )
    .join(', ')
  throw new Error(
    `Real file or child-process work was still pending after ${PENDING_REAL_WORK_TURN_LIMIT} event-loop turns (${pendingInWords}); the faked clock was not moved.`,
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
 * The faked `performance.now()` answers its reading at this call, rounded up to a whole millisecond, plus the time the test advanced, so real time that passes afterwards never reaches a deadline.
 * The whole millisecond keeps a delay the product computes from two faked readings whole: from a fraction, a 5 s deadline minus the reading can come out as 5000.000000000004 ms in floating point, and Node's mock timers do not fire that delay when the clock reaches 5 s, only at the next step.
 * Call it after the arrangement that needs real timers, and {@link resetFakeClock} before real waits resume.
 *
 * @param context - The running test's context.
 * @example
 * enableFakeClock(context)
 * await advanceClock(context, 4_000) // four fake seconds in about half a real one
 * resetFakeClock(context)
 */
export function enableFakeClock(context: TestContext): void {
  if (advancedMs.has(context)) return
  advancedMs.set(context, 0)
  // Read once: a start time the product stored before this call stays comparable, and no later real time is added. Rounded up, never down, so the faked clock does not read earlier than a real reading taken before it.
  const fakedAtMs = Math.ceil(performance.now())
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
 * Moves a test's faked clock forward by an exact amount, for a test that reads the product's state at a chosen faked time before or after one of its bounds.
 *
 * It steps as {@link advanceClockUntil} does: the clock moves only while no real file or child-process work is pending, so a timer the product sets after that work counts from the faked time the test stood at when it asked.
 *
 * @param context - The test whose clock {@link enableFakeClock} faked.
 * @param durationMs - Fake time to pass.
 * @throws When real file or child-process work stays pending for {@link PENDING_REAL_WORK_TURN_LIMIT} event-loop turns.
 * @example await advanceClock(context, 4_000)
 */
export async function advanceClock(
  context: TestContext,
  durationMs: number,
): Promise<void> {
  // A condition that never holds walks the whole duration: both waits share one stepping.
  await advanceClockUntil(context, () => false, durationMs)
}

/**
 * Moves the faked clock forward until a condition holds, and reports how much fake time that took.
 *
 * The clock moves only while no real file or child-process work is pending and never past `limitMs`: the last step is cut to what is left of the limit.
 *
 * @param context - The test whose clock {@link enableFakeClock} faked.
 * @param reached - The awaited condition, read after every real event-loop turn.
 * @param limitMs - Fake time after which the wait gives up.
 * @returns
 * - Fake milliseconds the clock was moved until the condition held: `0` when real work alone brought it about, at most `limitMs`
 * - `undefined` when it still did not hold at `limitMs`
 * @throws When real file or child-process work stays pending for {@link PENDING_REAL_WORK_TURN_LIMIT} event-loop turns.
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
