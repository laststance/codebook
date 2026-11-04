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
  /** The pause between reads. */
  sleep?: (ms: number) => Promise<void>
  /** Reads the `DevToolsActivePort` file; a rejection counts as "not written yet". */
  readText?: (path: string) => Promise<string>
}

/**
 * Waits until a headless Chrome a test started publishes its debugging endpoint in its profile's `DevToolsActivePort` file.
 *
 * Why it exists: a cold CI runner's first Chrome start took 10 to 15+ s (measured for {@link EXTENSION_BROWSER_START_BOUND_MS}), longer than the test helpers' own loops waited, which failed whole CI shards. Both real-Chrome helpers ({@link openRealChromePage}'s browser and {@link launchRealHeadlessPage}) wait through this one function with Codebook's own start bound.
 * The reads and the pauses both count toward the bound ({@link PollBudget}); each pause is cut to what is left of it, and the last look comes at the bound, so the call rejects no later than the bound plus one read. A valid endpoint a read returns is accepted.
 * @param profile - The Chrome profile folder the test passed as `--user-data-dir`.
 * @param options - A shorter bound or fake seams for tests; the defaults are the real file, clock and timers.
 * @returns The endpoint's port and its `/devtools/browser/…` path.
 * @throws `Chrome published no debugging endpoint within <s> s.` once the bound is spent.
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
  // Read, then stop at a spent bound, then pause for at most what is left: the last look comes at the bound.
  for (;;) {
    const text = await budget.measure(() => readText(file).catch(() => ''))
    const endpoint = readDevToolsActivePort(text)
    if (endpoint) return endpoint
    if (budget.isSpent())
      throw new Error(
        `Chrome published no debugging endpoint within ${boundMs / 1000} s.`,
      )
    await budget.pause(sleep, Math.min(pollMs, budget.remainingMs()))
  }
}
