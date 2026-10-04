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

/** What a watch reads and is bounded by: the options of {@link waitForWikiPublish}. */
type WikiPublishWatch<Published> = Parameters<
  typeof waitForWikiPublish<Published>
>[0]

/** What a watch remembers from one look to the next. */
interface WikiPublishWatchMemory {
  /** The stamp of the last complete look; undefined forces the next look. */
  lookedAtStamp: string | undefined
  /** The new publish whose manifest could not be read, and when that was first seen. */
  unreadable: { token: string; sinceMs: number } | undefined
}

/** What one turn of a watch gives besides an end: `look-again` starts the next turn at once, `sleep` waits for the poll delay first. */
type WikiPublishWatchTurn<Published> =
  WikiPublishWait<Published> | 'look-again' | 'sleep'

/**
 * Remembers a new publish whose manifest cannot be read and says since when; called by {@link lookAtNewPublish}.
 * @param memory - The watch's memory; a token it has not seen as unreadable is noted with the present time.
 * @param token - The publish token of the unreadable manifest.
 * @param now - Clock in milliseconds; read only for a token seen for the first time.
 * @returns When this token was first seen unreadable.
 * @example
 * unreadableSince(memory, 'b@2', Date.now) // => 1790000000000
 */
function unreadableSince(
  memory: WikiPublishWatchMemory,
  token: string,
  now: () => number,
): number {
  if (memory.unreadable?.token !== token)
    memory.unreadable = { token, sinceMs: now() }
  return memory.unreadable.sinceMs
}

/**
 * Reads the manifest of a new publish and decides whether the watch ends with it; called by {@link lookAtWiki} when the publish token differs from the start's.
 * @param watch - The watch's options.
 * @param memory - The watch's memory; an unreadable manifest is noted and the next look is forced.
 * @param token - The new publish token.
 * @param now - Clock in milliseconds.
 * @returns
 * - `cancelled` when the signal aborted while the manifest was read
 * - `published` with what the caller read from the manifest
 * - `unreadable` when the manifest was still not readable `unreadableGraceMs` after that was first seen
 * - `undefined` while an unreadable manifest may still be being written: the watch goes on
 * @example
 * await lookAtNewPublish(watch, memory, 'b@2', Date.now) // => { outcome: 'published', token: 'b@2', published }
 */
async function lookAtNewPublish<Published>(
  watch: WikiPublishWatch<Published>,
  memory: WikiPublishWatchMemory,
  token: string,
  now: () => number,
): Promise<WikiPublishWait<Published> | undefined> {
  const published = await watch.readPublished()
  // A cancel that arrived while the manifest was read is not answered with a publish.
  if (watch.signal.aborted) return { outcome: 'cancelled' }
  if (published !== undefined) return { outcome: 'published', token, published }
  const sinceMs = unreadableSince(memory, token, now)
  // A manifest that stays invalid is not "still being written": waiting out the whole bound would hide it.
  if (now() - sinceMs >= watch.unreadableGraceMs)
    return { outcome: 'unreadable', token }
  // A manifest that is invalid right after its token changed is still being written; look again next time.
  memory.lookedAtStamp = undefined
  return undefined
}

/**
 * Asks for the learner-owned files that make the publisher refuse the candidate; called by {@link lookForBlockingFiles}.
 * @param watch - The watch's options.
 * @param memory - The watch's memory; a look that failed forces the next look.
 * @returns The blocking paths; none without a probe, and none when the probe failed (a folder vanished under it): that found nothing this time and never ends the run.
 * @example
 * await findBlockingPaths(watch, memory) // => ['notes/mine.md']
 */
async function findBlockingPaths<Published>(
  watch: WikiPublishWatch<Published>,
  memory: WikiPublishWatchMemory,
): Promise<string[]> {
  try {
    return (await watch.findBlockingFiles?.()) ?? []
  } catch {
    // A look that failed (a folder vanished under it) found nothing this time; it never ends the run.
    memory.lookedAtStamp = undefined
    return []
  }
}

/**
 * Looks whether a candidate is refused while nothing new is published; called by {@link lookAtWiki} when the publish token is still the start's or the manifest is missing.
 * @param watch - The watch's options.
 * @param memory - The watch's memory; an earlier unreadable publish is forgotten.
 * @param token - The publish token this look read.
 * @returns
 * - `blocked` with the paths, when the publish token is still the same after the probe
 * - `look-again` when a publish landed while the probe ran, whose new pages look like learner files in the way
 * - `undefined` when nothing blocks: the watch goes on
 * @example
 * await lookForBlockingFiles(watch, memory, 'a@1') // => { outcome: 'blocked', paths: ['notes/mine.md'] }
 */
async function lookForBlockingFiles<Published>(
  watch: WikiPublishWatch<Published>,
  memory: WikiPublishWatchMemory,
  token: string | undefined,
): Promise<WikiPublishWait<Published> | 'look-again' | undefined> {
  memory.unreadable = undefined
  // A refused candidate never publishes, so waiting out the bound would hide the reason.
  const blocking = await findBlockingPaths(watch, memory)
  if (!blocking.length) return undefined
  // A publish that landed while the probe ran makes its new pages look like learner files in the way.
  if ((await watch.readToken()) === token)
    return { outcome: 'blocked', paths: blocking }
  memory.lookedAtStamp = undefined
  return 'look-again'
}

/**
 * Makes one complete look at the Wiki; called by {@link lookIfWritten} when something was written since the last look.
 * @param watch - The watch's options.
 * @param memory - The watch's memory; the stamp of this look is noted.
 * @param stamp - The stamp read before this look, if the watch has one.
 * @param now - Clock in milliseconds.
 * @returns What {@link lookAtNewPublish} gives for a publish token that differs from the start's, what {@link lookForBlockingFiles} gives otherwise.
 * @example
 * await lookAtWiki(watch, memory, 'stamp-2', Date.now) // => undefined while nothing is published and nothing blocks
 */
async function lookAtWiki<Published>(
  watch: WikiPublishWatch<Published>,
  memory: WikiPublishWatchMemory,
  stamp: string | undefined,
  now: () => number,
): Promise<WikiPublishWait<Published> | 'look-again' | undefined> {
  memory.lookedAtStamp = stamp
  const token = await watch.readToken()
  if (token !== undefined && token !== watch.startToken)
    return lookAtNewPublish(watch, memory, token, now)
  return lookForBlockingFiles(watch, memory, token)
}

/**
 * Reads the watch's stamp and looks at the Wiki unless nothing was written since the last complete look; called by {@link takeWatchTurn}.
 * @param watch - The watch's options.
 * @param memory - The watch's memory.
 * @param now - Clock in milliseconds.
 * @returns What {@link lookAtWiki} gives; `undefined` also for a skipped look.
 * @example
 * await lookIfWritten(watch, memory, Date.now) // => undefined while the stamp is the one of the last look
 */
async function lookIfWritten<Published>(
  watch: WikiPublishWatch<Published>,
  memory: WikiPublishWatchMemory,
  now: () => number,
): Promise<WikiPublishWait<Published> | 'look-again' | undefined> {
  const stamp = await watch.readStamp?.()
  // Reading the manifest and walking the folder is repeated only when something was written since the last look.
  if (stamp !== undefined && stamp === memory.lookedAtStamp) return undefined
  return lookAtWiki(watch, memory, stamp, now)
}

/**
 * Takes one turn of the watch: the cancel check, a look, the bound; called by {@link watchInTurns} until a turn ends the watch.
 * @param watch - The watch's options.
 * @param memory - The watch's memory.
 * @param now - Clock in milliseconds.
 * @param deadline - When the whole watch ends, on that clock.
 * @returns
 * - How the watch ended: `cancelled` before the look, what the look found, or `timed-out` at the bound
 * - `look-again` when the next turn starts at once, without the bound check and the delay
 * - `sleep` when the next turn starts after the poll delay
 * @example
 * await takeWatchTurn(watch, memory, Date.now, deadline) // => 'sleep'
 */
async function takeWatchTurn<Published>(
  watch: WikiPublishWatch<Published>,
  memory: WikiPublishWatchMemory,
  now: () => number,
  deadline: number,
): Promise<WikiPublishWatchTurn<Published>> {
  if (watch.signal.aborted) return { outcome: 'cancelled' }
  const found = await lookIfWritten(watch, memory, now)
  if (found !== undefined) return found
  return now() >= deadline ? { outcome: 'timed-out' } : 'sleep'
}

/**
 * Repeats the turns of a watch until one ends it, with the poll delay between two turns; called by {@link waitForWikiPublish} with its clock, its delay and its bound.
 * @param watch - The watch's options.
 * @param now - Clock in milliseconds.
 * @param sleep - Delay function, which ends early when the signal aborts.
 * @param deadline - When the whole watch ends, on that clock.
 * @returns How the watch ended.
 * @example
 * await watchInTurns(watch, Date.now, sleepUntilAborted, Date.now() + 900_000) // => { outcome: 'timed-out' }
 */
async function watchInTurns<Published>(
  watch: WikiPublishWatch<Published>,
  now: () => number,
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>,
  deadline: number,
): Promise<WikiPublishWait<Published>> {
  const memory: WikiPublishWatchMemory = {
    lookedAtStamp: undefined,
    unreadable: undefined,
  }
  for (;;) {
    const turn = await takeWatchTurn(watch, memory, now, deadline)
    if (turn === 'sleep') await sleep(watch.pollMs, watch.signal)
    else if (turn !== 'look-again') return turn
  }
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
  return watchInTurns(options, now, sleep, deadline)
}
