/** How a watch for a published Wiki ended. */
export type WikiPublishWait =
  | { outcome: 'published'; identity: string }
  | { outcome: 'not-current'; identity: string }
  | { outcome: 'blocked'; paths: string[] }
  | { outcome: 'cancelled' }
  | { outcome: 'timed-out' }

/** Resolves after the delay or when the signal aborts, whichever comes first; the timer never keeps the process alive. */
function sleepUntilAborted(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    // An abort that happened before the sleep started would never fire its listener.
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, delayMs)
    timer.unref()
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/**
 * Watches the owned manifest until the editor agent publishes a new site, the learner cancels or the bound passes.
 *
 * Why: VS Code's chat API reports no result, so the extension can only see the publish itself. The publisher replaces the site atomically, so a changed manifest identity means a complete site.
 * Trigger: the extension starts it right after opening the chat for a VS Code Wiki update; the reader shows its outcome.
 *
 * @param options.startIdentity - Manifest identity before the update; undefined when the manifest was unreadable.
 * @param options.readIdentity - Reads the published identity; undefined while the manifest is missing, mid-replacement or invalid.
 * @param options.isCurrent - Whether the published site's sources match the project now.
 * @param options.findBlockingFiles - Names learner-owned files that make the publisher refuse the candidate; optional.
 * @param options.signal - Aborts the watch (learner cancel, extension shutdown).
 * @param options.timeoutMs - Bound on the whole watch.
 * @param options.pollMs - Delay between looks.
 * @param options.now - Clock in milliseconds; tests pass a manual one.
 * @param options.sleep - Delay function; tests pass one that advances the manual clock.
 * @returns
 * - `published`: the identity changed and the site is current
 * - `not-current`: the identity changed but the site still differs from the project
 * - `blocked`: the publisher would refuse the candidate because of those learner-owned files
 * - `cancelled`: the signal aborted first
 * - `timed-out`: nothing was published within `timeoutMs`
 *
 * @example
 * ```ts
 * await waitForWikiPublish({ startIdentity: 'a+1', readIdentity, isCurrent, signal, timeoutMs: 900_000, pollMs: 2_000 })
 * // => { outcome: 'published', identity: 'b+2' }
 * ```
 */
export async function waitForWikiPublish(options: {
  startIdentity: string | undefined
  readIdentity: () => Promise<string | undefined>
  isCurrent: () => Promise<boolean>
  findBlockingFiles?: () => Promise<string[]>
  signal: AbortSignal
  timeoutMs: number
  pollMs: number
  now?: () => number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiPublishWait> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepUntilAborted
  const deadline = now() + options.timeoutMs
  for (;;) {
    if (options.signal.aborted) return { outcome: 'cancelled' }
    const identity = await options.readIdentity()
    // A manifest that is missing or invalid is the publisher mid-replacement; keep watching.
    if (identity !== undefined && identity !== options.startIdentity)
      return {
        outcome: (await options.isCurrent()) ? 'published' : 'not-current',
        identity,
      }
    // A refused candidate never publishes, so waiting out the bound would hide the reason.
    const blocking = (await options.findBlockingFiles?.()) ?? []
    if (blocking.length) return { outcome: 'blocked', paths: blocking }
    if (now() >= deadline) return { outcome: 'timed-out' }
    await sleep(options.pollMs, options.signal)
  }
}
