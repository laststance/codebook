import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  EXTENSION_BROWSER_POLL_MS,
  EXTENSION_BROWSER_START_BOUND_MS,
} from '../../constants'
import { PollBudget } from '../../runtimeSupport/utils/pollBudget'
import { readDevToolsActivePort } from '../../runtimeSupport/utils/readDevToolsActivePort'

/** Seams of {@link waitForTestBrowserEndpoint}; a unit test passes a fake clock, sleep and reader. */
export type TestBrowserEndpointOptions = {
  /** How long the first start may take; Codebook's own browser start bound unless a test names a shorter one. */
  boundMs?: number
  /** The longest pause between two reads of the file. */
  pollMs?: number
  /** The monotonic clock that times each read. */
  now?: () => number
  /** The pause between reads; its real duration is charged, so a fake must move the clock by at least `ms`. */
  sleep?: (ms: number) => Promise<void>
  /** Reads the `DevToolsActivePort` file; a rejection counts as "not written yet". */
  readText?: (path: string) => Promise<string>
  /** Says whether the Chrome process already ended, so a crashed start fails at once instead of at the bound. */
  hasExited?: () => boolean
}

/**
 * Names a read failure that is more than "the file is not there yet", for the message {@link waitForTestBrowserEndpoint} gives up with.
 * @param error - What the read rejected with.
 * @returns The error code (`EACCES`, `EMFILE`, …) or message; `undefined` for a missing file.
 * @example readFailureOf(Object.assign(new Error('denied'), { code: 'EACCES' })) // => 'EACCES'
 */
function readFailureOf(error: unknown): string | undefined {
  const code =
    error instanceof Error && 'code' in error ? String(error.code) : undefined
  if (code === 'ENOENT') return undefined
  return code ?? String(error)
}

/**
 * Waits until a headless Chrome a test started publishes its debugging endpoint in its profile's `DevToolsActivePort` file.
 *
 * Why it exists: a cold CI runner's first Chrome start took 10 to 15+ s (measured for {@link EXTENSION_BROWSER_START_BOUND_MS}), longer than the test helpers' own loops waited, which failed whole CI shards. Both real-Chrome helpers ({@link openRealChromePage}'s browser and {@link launchRealHeadlessPage}) wait through this one function with Codebook's own start bound.
 * The real time of the reads and of the pauses counts toward the bound ({@link PollBudget}), so a late timer on a loaded runner cannot stretch it; each pause is cut to what is left of the bound, and the last look comes at the bound. A valid endpoint a read returns is accepted.
 * @param profile - The Chrome profile folder the test passed as `--user-data-dir`.
 * @param options - A shorter bound, the Chrome process's exit check, or fake seams for tests; the defaults are the real file, clock and timers.
 * @returns The endpoint's port and its `/devtools/browser/…` path.
 * @throws `Chrome exited before it published its debugging endpoint.` as soon as `hasExited` says so; `Chrome published no debugging endpoint within <s> s.` once the bound is spent, naming the last read failure that was not a missing file.
 * @example
 * const { port, path } = await waitForTestBrowserEndpoint(profile)
 * // => { port: 51234, path: '/devtools/browser/0f…' }
 */
export async function waitForTestBrowserEndpoint(
  profile: string,
  options: TestBrowserEndpointOptions = {},
): Promise<{ port: number; path: string }> {
  const boundMs = options.boundMs ?? EXTENSION_BROWSER_START_BOUND_MS
  const pollMs = options.pollMs ?? EXTENSION_BROWSER_POLL_MS
  const sleep = options.sleep ?? ((ms: number): Promise<void> => delay(ms))
  const readText =
    options.readText ?? ((path: string) => readFile(path, 'utf8'))
  const file = join(profile, 'DevToolsActivePort')
  const budget = new PollBudget(boundMs, options.now)
  let lastReadFailure: string | undefined
  // Read, then stop at an ended process or a spent bound, then pause for at most what is left: the last look comes at the bound.
  for (;;) {
    const text = await budget.measure(() =>
      readText(file).catch((error: unknown) => {
        lastReadFailure = readFailureOf(error) ?? lastReadFailure
        return ''
      }),
    )
    const endpoint = readDevToolsActivePort(text)
    if (endpoint) return endpoint
    if (options.hasExited?.())
      throw new Error(
        'Chrome exited before it published its debugging endpoint.',
      )
    if (budget.isSpent())
      throw new Error(
        `Chrome published no debugging endpoint within ${boundMs / 1000} s.${lastReadFailure === undefined ? '' : ` The last read failed with ${lastReadFailure}.`}`,
      )
    const pauseMs = Math.min(pollMs, budget.remainingMs())
    await budget.measure(() => sleep(pauseMs))
  }
}
