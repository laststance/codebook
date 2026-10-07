import { sleepUntilAborted } from './sleepUntilAborted'

/** How a watch for a published Wiki ended; `published` carries the new publish token and what the caller read from the new manifest, `unreadable` the token of a publish whose manifest stayed unreadable, and `reply-ended` says that the chat's reply ended and the look after it found no publish. */
export type WikiPublishWait<Published> =
  | { outcome: 'published'; token: string; published: Published }
  | { outcome: 'unreadable'; token: string }
  | { outcome: 'blocked'; paths: string[] }
  | { outcome: 'reply-ended' }
  | { outcome: 'cancelled' }
  | { outcome: 'timed-out' }

/** What {@link waitForWikiPublish} is given. */
type WikiPublishWatchOptions<Published> = {
  startToken: string | undefined
  readToken: () => Promise<string | undefined>
  readPublished: () => Promise<Published | undefined>
  unreadableGraceMs: number
  readStamp?: () => Promise<string>
  findBlockingFiles?: () => Promise<string[]>
  replyEnded?: AbortSignal
  signal: AbortSignal
  timeoutMs: number
  pollMs: number
  now?: () => number
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
}

/** One watch as its looks share it: the options with their defaults resolved, the bound, the stamp of the last complete look (undefined forces the next look), and the new publish whose manifest could not be read, with the time that was first seen. */
type WikiPublishWatch<Published> = {
  options: WikiPublishWatchOptions<Published>
  now: () => number
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
  deadline: number
  lookedAtStamp: string | undefined
  unreadable: { token: string; sinceMs: number } | undefined
}

/** What one look found: the watch's end, `nothing` (a complete look, or one skipped because nothing was written, found nothing new), `unreadable-yet` (a new publish whose manifest is still being written) or `retry` (the site changed under the look, which is taken again at once). */
type WikiPublishLook<Published> =
  WikiPublishWait<Published> | 'nothing' | 'unreadable-yet' | 'retry'

/**
 * Says whether a look must read the site, and notes the stamp it looks at; called by {@link look} first.
 * @param watch - The watch.
 * @returns `false` when a stamp reader is given and the stamp is the one of the last complete look; `true` otherwise.
 * @example
 * await isLookDue(watch) // => false while nothing was written since the last look
 */
async function isLookDue<Published>(
  watch: WikiPublishWatch<Published>,
): Promise<boolean> {
  const stamp = await watch.options.readStamp?.()
  // Reading the manifest and walking the folder is repeated only when something was written since the last look.
  if (stamp !== undefined && stamp === watch.lookedAtStamp) return false
  watch.lookedAtStamp = stamp
  return true
}

/**
 * Gives a new publish whose manifest cannot be read its grace; called by {@link lookAtNewPublish}.
 * @param watch - The watch.
 * @param token - The new publish token.
 * @returns `unreadable` once the manifest stayed invalid for the grace since it was first seen; `unreadable-yet` before, with the next look forced.
 * @example
 * waitForReadableManifest(watch, 'b@2') // => 'unreadable-yet' right after the token changed
 */
function waitForReadableManifest<Published>(
  watch: WikiPublishWatch<Published>,
  token: string,
): WikiPublishLook<Published> {
  if (watch.unreadable?.token !== token)
    watch.unreadable = { token, sinceMs: watch.now() }
  // A manifest that stays invalid is not "still being written": waiting out the whole bound would hide it.
  if (watch.now() - watch.unreadable.sinceMs >= watch.options.unreadableGraceMs)
    return { outcome: 'unreadable', token }
  // A manifest that is invalid right after its token changed is still being written; look again next time.
  watch.lookedAtStamp = undefined
  return 'unreadable-yet'
}

/**
 * Reads a newly published manifest; called by {@link look} when the publish token differs from the start's.
 * @param watch - The watch.
 * @param token - The new publish token.
 * @returns `cancelled` when the signal aborted while the manifest was read, `published` for a readable manifest, otherwise the answer of {@link waitForReadableManifest}.
 * @example
 * await lookAtNewPublish(watch, 'b@2') // => { outcome: 'published', token: 'b@2', published }
 */
async function lookAtNewPublish<Published>(
  watch: WikiPublishWatch<Published>,
  token: string,
): Promise<WikiPublishLook<Published>> {
  const published = await watch.options.readPublished()
  // A cancel that arrived while the manifest was read is not answered with a publish.
  if (watch.options.signal.aborted) return { outcome: 'cancelled' }
  if (published !== undefined) return { outcome: 'published', token, published }
  return waitForReadableManifest(watch, token)
}

/**
 * Asks for the learner files that would make the publisher refuse the candidate; called by {@link lookForBlockingFiles}.
 * @param watch - The watch.
 * @returns The paths; none without a probe, and none for a probe that failed (a folder vanished under it), which forces the next look and never ends the run.
 * @example
 * await findBlockingFiles(watch) // => ['pages/notes.html']
 */
async function findBlockingFiles<Published>(
  watch: WikiPublishWatch<Published>,
): Promise<string[]> {
  try {
    return (await watch.options.findBlockingFiles?.()) ?? []
  } catch {
    watch.lookedAtStamp = undefined
    return []
  }
}

/**
 * Looks for a refused candidate while nothing new is published; called by {@link look} when the publish token is the start's.
 *
 * Why: a refused candidate never publishes, so waiting out the bound would hide the reason.
 *
 * @param watch - The watch.
 * @param token - The publish token the look read.
 * @returns `blocked` with the paths when the token is still the same after the probe; `retry` when a publish landed while the probe ran (its new pages look like learner files in the way); `nothing` without blocking files.
 * @example
 * await lookForBlockingFiles(watch, 'a@1') // => 'nothing'
 */
async function lookForBlockingFiles<Published>(
  watch: WikiPublishWatch<Published>,
  token: string | undefined,
): Promise<WikiPublishLook<Published>> {
  watch.unreadable = undefined
  const blocking = await findBlockingFiles(watch)
  if (!blocking.length) return 'nothing'
  if ((await watch.options.readToken()) === token)
    return { outcome: 'blocked', paths: blocking }
  watch.lookedAtStamp = undefined
  return 'retry'
}

/**
 * Takes one look at the Wiki's output; called by {@link lookOrEnd} at every turn of the watch.
 * @param watch - The watch.
 * @returns `nothing` for a look that was not due; otherwise the answer of {@link lookAtNewPublish} for a new publish token and of {@link lookForBlockingFiles} for the start's.
 * @example
 * await look(watch) // => 'nothing' while the agent has published nothing
 */
async function look<Published>(
  watch: WikiPublishWatch<Published>,
): Promise<WikiPublishLook<Published>> {
  if (!(await isLookDue(watch))) return 'nothing'
  const token = await watch.options.readToken()
  return token !== undefined && token !== watch.options.startToken
    ? lookAtNewPublish(watch, token)
    : lookForBlockingFiles(watch, token)
}

/**
 * Decides what follows a look that found no end of the watch; called by {@link lookOrEnd}.
 * @param watch - The watch.
 * @param found - What the look found.
 * @param isLastLook - Whether the chat's reply had ended before the look began.
 * @returns `reply-ended` after a complete look that followed the reply's end; `timed-out` at the bound; otherwise `wait`.
 * @example
 * endOrWait(watch, 'nothing', true) // => { outcome: 'reply-ended' }
 */
function endOrWait<Published>(
  watch: WikiPublishWatch<Published>,
  found: 'nothing' | 'unreadable-yet',
  isLastLook: boolean,
): WikiPublishWait<Published> | 'wait' {
  // A manifest that is still being written keeps its grace also after the reply ended.
  if (found === 'nothing' && isLastLook) return { outcome: 'reply-ended' }
  return watch.now() >= watch.deadline ? { outcome: 'timed-out' } : 'wait'
}

/**
 * Takes one turn of the watch: the cancel, one look, and what follows it; called by {@link waitForWikiPublish} in its loop.
 * @param watch - The watch.
 * @param isLastLook - Whether the chat's reply had ended before this turn began, so this look is the one that decides.
 * @returns The watch's end, `wait` (sleep, then look again) or `retry` (look again at once).
 * @example
 * await lookOrEnd(watch, false) // => 'wait'
 */
async function lookOrEnd<Published>(
  watch: WikiPublishWatch<Published>,
  isLastLook: boolean,
): Promise<WikiPublishWait<Published> | 'wait' | 'retry'> {
  if (watch.options.signal.aborted) return { outcome: 'cancelled' }
  const found = await look(watch)
  if (found === 'nothing' || found === 'unreadable-yet')
    return endOrWait(watch, found, isLastLook)
  return found
}

/**
 * Says whether the chat's reply has ended; called by {@link waitForWikiPublish} before every look.
 * @param options - The watch's options.
 * @returns `true` once the signal of the reply's end aborted; `false` before, and for a watch that follows no reply.
 * @example
 * hasReplyEnded({ replyEnded: undefined }) // => false
 */
function hasReplyEnded(options: { replyEnded?: AbortSignal }): boolean {
  return Boolean(options.replyEnded?.aborted)
}

/**
 * Picks the signal that ends the sleep between two looks; called by {@link waitForWikiPublish}.
 * @param options - The watch's options.
 * @param isLastLook - Whether the chat's reply has ended.
 * @returns The watch's signal joined with the reply's end, so the look that decides comes at once; the watch's signal alone when no reply is followed or it has ended (a manifest that is still being written is then waited for at the usual pace).
 * @example
 * sleepSignalOf({ signal, replyEnded }, false) // aborts when either does
 */
function sleepSignalOf(
  options: { signal: AbortSignal; replyEnded?: AbortSignal },
  isLastLook: boolean,
): AbortSignal {
  return isLastLook || options.replyEnded === undefined
    ? options.signal
    : AbortSignal.any([options.signal, options.replyEnded])
}

/**
 * Sets a watch up from its options; called once by {@link waitForWikiPublish}.
 * @param options - The watch's options.
 * @returns The watch, with the system clock and the abortable sleep where none is given, and the bound counted from now.
 * @example
 * startWatch({ ...options, timeoutMs: 900_000 }).deadline // => now + 900 000
 */
function startWatch<Published>(
  options: WikiPublishWatchOptions<Published>,
): WikiPublishWatch<Published> {
  const now = options.now ?? Date.now
  return {
    options,
    now,
    sleep: options.sleep ?? sleepUntilAborted,
    deadline: now() + options.timeoutMs,
    lookedAtStamp: undefined,
    unreadable: undefined,
  }
}

/**
 * Watches the owned manifest until the editor agent publishes a new site, the chat's reply ends without one, the learner cancels or the bound passes.
 *
 * Why: a chat that works on the request says nothing to Codebook until its reply ends, so the extension sees the publish itself. The publisher replaces the site atomically and writes a new manifest file each time, so a changed publish token with a readable manifest means a complete new site. A reply that ends is the chat's last word: one more look decides, so a chat that stopped without publishing is not watched for the whole bound.
 * Trigger: the extension starts it right after opening the chat for a VS Code Wiki update; {@link classifyWikiUpdateEnd} turns its outcome into the result the reader shows.
 *
 * @param options.startToken - Publish token ({@link readWikiPublishToken}) before the update; undefined when the manifest was unreadable.
 * @param options.readToken - Reads the publish token now; undefined while the manifest is missing or mid-replacement.
 * @param options.readPublished - Reads what the caller needs from the newly published manifest; undefined while it is invalid, which keeps the watch going for `unreadableGraceMs`.
 * @param options.unreadableGraceMs - How long a new publish may stay unreadable before the watch ends as `unreadable`; a manifest that is still being written becomes readable within it.
 * @param options.readStamp - Reads a cheap stamp of what a look reads ({@link readWikiWatchStamp}); a look is skipped while the stamp is the same as at the last complete look. Omitted: every look reads everything.
 * @param options.findBlockingFiles - Names learner-owned files that make the publisher refuse the candidate; optional. Its answer counts only when the publish token is still the same after it; a rejection is "no finding this look".
 * @param options.replyEnded - Aborts when the chat's reply ended ({@link watchWikiChatReply}); the sleep under way ends, and the look that follows decides. Omitted: the watch ends only by a publish, a refusal, the cancel or the bound.
 * @param options.signal - Aborts the watch (learner cancel, extension shutdown).
 * @param options.timeoutMs - Bound on the whole watch.
 * @param options.pollMs - Delay between looks.
 * @param options.now - Clock in milliseconds; tests pass a manual one.
 * @param options.sleep - Delay function; tests pass one that advances the manual clock.
 * @returns
 * - `published`: the publish token changed and the new manifest is readable
 * - `unreadable`: the publish token changed and the new manifest was still not readable `unreadableGraceMs` after that was first seen
 * - `blocked`: the publisher would refuse the candidate because of those learner-owned files
 * - `reply-ended`: the chat's reply ended, and a complete look that began after that found no publish and no refusal
 * - `cancelled`: the signal aborted first, also while the new manifest was being read
 * - `timed-out`: nothing was published within `timeoutMs`
 *
 * @example
 * ```ts
 * await waitForWikiPublish({ startToken: 'a@1', readToken, readPublished, unreadableGraceMs: 10_000, signal, timeoutMs: 900_000, pollMs: 2_000 })
 * // => { outcome: 'published', token: 'b@2', published: { identity: 'a1b2c3d4e5f6+0f9e8d7c', freshness } }
 * ```
 */
export async function waitForWikiPublish<Published>(
  options: WikiPublishWatchOptions<Published>,
): Promise<WikiPublishWait<Published>> {
  const watch = startWatch(options)
  for (;;) {
    // The reply's end is read before the look, so a publish that landed with it is found by this look.
    const isLastLook = hasReplyEnded(options)
    const step = await lookOrEnd(watch, isLastLook)
    if (typeof step === 'object') return step
    if (step === 'wait')
      await watch.sleep(options.pollMs, sleepSignalOf(options, isLastLook))
  }
}
