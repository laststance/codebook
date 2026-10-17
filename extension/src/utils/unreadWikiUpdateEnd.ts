import type { WikiUpdateEndFacts } from './classifyWikiUpdateEnd'
import { cutChatCause } from './cutChatCause'
import type { WikiUpdateEnd } from './wikiUpdateRun'

/** What a run that ended saw by itself, without a look at the disk: whether it was cancelled, passed its bound or met files of the learner's in the way. */
type ObservedWikiStop = Partial<
  Pick<WikiUpdateEndFacts, 'cancelled' | 'timedOut' | 'blockingPaths'>
>

/** How a run's end is recorded when the Wiki could not be read for it: the end itself, and the state the run would have ended in by what it observed, which decides whether its chat is still waited for. */
export type UnreadWikiUpdateEnd = {
  end: WikiUpdateEnd
  stoppedAs: WikiUpdateEnd['state']
}

/**
 * Names the state a run would have ended in by what it observed itself; called by {@link unreadWikiUpdateEnd}.
 * @param observed - What the run saw when it stopped.
 * @returns `cancelled`, `timed-out` or `conflict` for a run that stopped that way (in this order, as {@link classifyWikiUpdateEnd} weighs them); `failed` otherwise.
 * @example
 * stopObserved({ timedOut: true })                   // => 'timed-out'
 * stopObserved({ blockingPaths: ['notes.html'] })    // => 'conflict'
 * stopObserved({})                                   // => 'failed'
 */
function stopObserved({
  cancelled,
  timedOut,
  blockingPaths = [],
}: ObservedWikiStop): WikiUpdateEnd['state'] {
  if (cancelled) return 'cancelled'
  if (timedOut) return 'timed-out'
  return blockingPaths.length > 0 ? 'conflict' : 'failed'
}

/**
 * Builds the end of a Wiki update whose result could not be read from the disk; called by the extension when the reads that decide a run's end threw, so that the run does not stay "running" in its window.
 *
 * Why: every end of a run is decided from the disk (the publish token, the publication, the manifest). When those reads throw, nothing can be said of the site, and a run without a recorded end would refuse every later press as "already updating" until the window is reloaded. The end is therefore recorded as failed in a sentence Codebook wrote, with the site `missing`, the one value for which no reader says that the site was kept or replaced. What the run observed itself still decides whether its chat is waited for ({@link mayWikiChatStillPublish}).
 *
 * @param observed - What the run saw when it stopped.
 * @param thrownText - The message of what the reads threw.
 * @returns `end`: `failed` with the sentence (the thrown text in brackets, cut by {@link cutChatCause}), marked as Codebook's own, and no claim about the site; `stoppedAs`: the state of {@link stopObserved}.
 * @example
 * unreadWikiUpdateEnd({ cancelled: true }, 'EIO: i/o error, read')
 * // => { end: { state: 'failed', reason: 'Codebook could not read the Wiki folder to see how the update ended (EIO: i/o error, read), so it does not say whether the site was replaced. Check the Wiki’s freshness label, then press Update LLM Wiki again.', isCodebookSentence: true, site: 'missing' }, stoppedAs: 'cancelled' }
 */
export function unreadWikiUpdateEnd(
  observed: ObservedWikiStop,
  thrownText: string,
): UnreadWikiUpdateEnd {
  return {
    end: {
      state: 'failed',
      reason: `Codebook could not read the Wiki folder to see how the update ended (${cutChatCause(thrownText)}), so it does not say whether the site was replaced. Check the Wiki’s freshness label, then press Update LLM Wiki again.`,
      isCodebookSentence: true,
      site: 'missing',
    },
    stoppedAs: stopObserved(observed),
  }
}
