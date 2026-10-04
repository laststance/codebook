import { setTimeout as sleepFor } from 'node:timers/promises'

/** How a watch for a published Wiki ended; `published` carries the new publish token and what the caller read from the new manifest, `unreadable` the token of a publish whose manifest stayed unreadable. */
export type WikiPublishWait<Published> =
  | { outcome: 'published'; token: string; published: Published }
  | { outcome: 'unreadable'; token: string }
  | { outcome: 'blocked'; paths: string[] }
  | { outcome: 'cancelled' }
  | { outcome: 'timed-out' }

/** Resolves after the delay or when the signal aborts, whichever comes first; the timer never keeps the process alive. */
function sleepUntilAborted(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  return sleepFor(delayMs, undefined, { signal, ref: false }).catch(
    () => undefined,
  )
}

/**
 * Watches the owned manifest until the editor agent publishes a new site, the learner cancels or the bound passes.
 *
 * Why: VS Code's chat API reports no result, so the extension can only see the publish itself. The publisher replaces the site atomically and writes a new manifest file each time, so a changed publish token with a readable manifest means a complete new site.
 * Trigger: the extension starts it right after opening the chat for a VS Code Wiki update; {@link classifyWikiUpdateEnd} turns its outcome into the result the reader shows.
 *
 * @param options.startToken - Publish token ({@link readWikiPublishToken}) before the update; undefined when the manifest was unreadable.
 * @param options.readToken - Reads the publish token now; undefined while the manifest is missing or mid-replacement.
 * @param options.readPublished - Reads what the caller needs from the newly published manifest; undefined while it is invalid, which keeps the watch going for `unreadableGraceMs`.
 * @param options.unreadableGraceMs - How long a new publish may stay unreadable before the watch ends as `unreadable`; a manifest that is still being written becomes readable within it.
 * @param options.readStamp - Reads a cheap stamp of what a look reads ({@link readWikiWatchStamp}); a look is skipped while the stamp is the same as at the last complete look. Omitted: every look reads everything.
 * @param options.findBlockingFiles - Names learner-owned files that make the publisher refuse the candidate; optional. Its answer counts only when the publish token is still the same after it; a rejection is "no finding this look".
 * @param options.signal - Aborts the watch (learner cancel, extension shutdown).
 * @param options.timeoutMs - Bound on the whole watch.
 * @param options.pollMs - Delay between looks.
 * @param options.now - Clock in milliseconds; tests pass a manual one.
 * @param options.sleep - Delay function; tests pass one that advances the manual clock.
 * @returns
 * - `published`: the publish token changed and the new manifest is readable
 * - `unreadable`: the publish token changed and the new manifest was still not readable `unreadableGraceMs` after that was first seen
 * - `blocked`: the publisher would refuse the candidate because of those learner-owned files
 * - `cancelled`: the signal aborted first, also while the new manifest was being read
 * - `timed-out`: nothing was published within `timeoutMs`
 *
 * @example
 * ```ts
 * await waitForWikiPublish({ startToken: 'a@1', readToken, readPublished, unreadableGraceMs: 10_000, signal, timeoutMs: 900_000, pollMs: 2_000 })
 * // => { outcome: 'published', token: 'b@2', published: { identity: 'a1b2c3d4e5f6+0f9e8d7c', freshness } }
 * ```
 */
export async function waitForWikiPublish<Published>(options: {
  startToken: string | undefined
  readToken: () => Promise<string | undefined>
  readPublished: () => Promise<Published | undefined>
  unreadableGraceMs: number
  readStamp?: () => Promise<string>
  findBlockingFiles?: () => Promise<string[]>
  signal: AbortSignal
  timeoutMs: number
  pollMs: number
  now?: () => number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<WikiPublishWait<Published>> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepUntilAborted
  const deadline = now() + options.timeoutMs
  // The stamp of the last complete look; undefined forces the next look.
  let lookedAtStamp: string | undefined
  // The new publish whose manifest could not be read, and when that was first seen.
  let unreadable: { token: string; sinceMs: number } | undefined
  for (;;) {
    if (options.signal.aborted) return { outcome: 'cancelled' }
    const stamp = await options.readStamp?.()
    // Reading the manifest and walking the folder is repeated only when something was written since the last look.
    if (stamp === undefined || stamp !== lookedAtStamp) {
      lookedAtStamp = stamp
      const token = await options.readToken()
      if (token !== undefined && token !== options.startToken) {
        const published = await options.readPublished()
        // A cancel that arrived while the manifest was read is not answered with a publish.
        if (options.signal.aborted) return { outcome: 'cancelled' }
        if (published !== undefined)
          return { outcome: 'published', token, published }
        if (unreadable?.token !== token) unreadable = { token, sinceMs: now() }
        // A manifest that stays invalid is not "still being written": waiting out the whole bound would hide it.
        if (now() - unreadable.sinceMs >= options.unreadableGraceMs)
          return { outcome: 'unreadable', token }
        // A manifest that is invalid right after its token changed is still being written; look again next time.
        lookedAtStamp = undefined
      } else {
        unreadable = undefined
        // A refused candidate never publishes, so waiting out the bound would hide the reason.
        let blocking: string[] = []
        try {
          blocking = (await options.findBlockingFiles?.()) ?? []
        } catch {
          // A look that failed (a folder vanished under it) found nothing this time; it never ends the run.
          lookedAtStamp = undefined
        }
        if (blocking.length) {
          // A publish that landed while the probe ran makes its new pages look like learner files in the way.
          if ((await options.readToken()) === token)
            return { outcome: 'blocked', paths: blocking }
          lookedAtStamp = undefined
          continue
        }
      }
    }
    if (now() >= deadline) return { outcome: 'timed-out' }
    await sleep(options.pollMs, options.signal)
  }
}
