import { formatClockTime } from './formatClockTime'
import { hasWikiPublishEndedWait } from './hasWikiPublishEndedWait'
import {
  isAcknowledgedWikiLeftover,
  type WikiLeftover,
} from './isAcknowledgedWikiLeftover'
import type { WikiCandidate } from './listWikiCandidates'
import type { WikiUpdateMarker } from './readLiveWikiUpdateMarker'
import {
  selectActiveWikiCandidate,
  type WikiLastRun,
} from './selectActiveWikiCandidate'

/** One refusal of a Wiki update's start for an earlier chat that may still publish: the leftovers of that one chat the refusal names, which its "Update anyway" passes, and the sentence that names them. */
export type WikiLeftoverRefusal = { named: WikiLeftover[]; reason: string }

/** What {@link findUnacknowledgedWikiLeftover} weighs besides the Wiki folder: the clock, the watch bound, another window's marker, this window's last run of this output, what "Update anyway" already passed, and the listing of the candidates. */
type LeftoverLook = {
  nowMs: number
  watchTimeoutMs: number
  otherWindow: WikiUpdateMarker | undefined
  lastRun: WikiLastRun | undefined
  acknowledged: readonly WikiLeftover[]
  listCandidates: (outputDirectory: string) => Promise<WikiCandidate[]>
}

/**
 * Names another window's stopped watch whose chat may still publish; called by {@link findUnacknowledgedWikiLeftover} first.
 * Why: another window stopped watching its chat, which may still publish until the watch bound; like this window's own stopped watch, the learner may go on. A site published since that watch's end ended the wait: the reservation names no candidate, so this window knows no more of that chat's publish than its time.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param look - The clock, the watch bound and another window's marker.
 * @returns The refusal for that window's chat; `undefined` without another window's stopped watch, after its bound, and once a site was published since its end.
 * @example
 * await reservationRefusal('/repo/.codebook/wiki', look) // => { named: [{ kind: 'reservation', windowId: '3f6c', startedAtMs: 1_790_000_000_000 }], reason: 'The VS Code chat another editor window asked at …' }
 */
async function reservationRefusal(
  outputDirectory: string,
  { nowMs, watchTimeoutMs, otherWindow }: LeftoverLook,
): Promise<WikiLeftoverRefusal | undefined> {
  const watchEndedAtMs = otherWindow?.watchEndedAtMs
  if (
    otherWindow === undefined ||
    watchEndedAtMs === undefined ||
    nowMs >= watchEndedAtMs + watchTimeoutMs ||
    (await hasWikiPublishEndedWait(outputDirectory, {
      watchEndedAtMs,
      candidateNames: [],
    }))
  )
    return undefined
  return {
    named: [
      {
        kind: 'reservation',
        windowId: otherWindow.windowId,
        startedAtMs: otherWindow.startedAtMs,
      },
    ],
    reason: `The VS Code chat another editor window asked at ${formatClockTime(otherWindow.startedAtMs, {})} may still be updating this Wiki; that window stopped watching it at ${formatClockTime(watchEndedAtMs, {})} and Codebook waits for it until ${formatClockTime(watchEndedAtMs + watchTimeoutMs, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
  }
}

/**
 * Says whether this window's own stopped watch still has a chat that may work; called by {@link findUnacknowledgedWikiLeftover} after the look at the candidates.
 * Why: a watch that stopped before the chat staged anything left no candidate, yet the chat may still work. Its own publish since the watch's end ended the wait: the page has shown that publish, and nothing is left to wait for.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param look - The clock, the watch bound and this window's last run of this output.
 * @returns That last run while its chat is waited for; `undefined` for a run whose chat cannot work any more, after the watch bound, and once that chat's publish came after the watch's end.
 * @example
 * await awaitedOwnRunOf('/repo/.codebook/wiki', look) // => { outputDirectory: '/repo/.codebook/wiki', startedAtMs: 1_000, endedAtMs: 2_000, mayAgentStillWork: true, candidateNames: [] }
 */
async function awaitedOwnRunOf(
  outputDirectory: string,
  { nowMs, watchTimeoutMs, lastRun }: LeftoverLook,
): Promise<WikiLastRun | undefined> {
  if (
    !lastRun?.mayAgentStillWork ||
    nowMs >= lastRun.endedAtMs + watchTimeoutMs
  )
    return undefined
  const hasPublishEndedWait = await hasWikiPublishEndedWait(outputDirectory, {
    watchEndedAtMs: lastRun.endedAtMs,
    candidateNames: lastRun.candidateNames ?? [],
  })
  return hasPublishEndedWait ? undefined : lastRun
}

/**
 * Words the refusals for the latest active candidate and for this window's own stopped watch; called by {@link findUnacknowledgedWikiLeftover}.
 * Why: a candidate this window's stopped watch saw is that watch's chat's, so one refusal names both and its "Update anyway" passes both; a candidate the watch never saw is named in a refusal of its own, before the refusal for the watch.
 * @param activeCandidate - The candidate that shows someone is still updating this Wiki ({@link selectActiveWikiCandidate}); `undefined` when there is none.
 * @param awaitedOwnRun - This window's own stopped watch while its chat is waited for; `undefined` otherwise.
 * @param watchTimeoutMs - The watch bound, which each sentence's "waits for it until" adds.
 * @returns The candidate's refusal first, then the watch's; one refusal that names both when the watch saw the candidate, and the later end of the two waits: the candidate's (its writing plus the bound) or the watch's (its end plus the bound), so a press at the named time is not refused again for the same chat.
 * @example
 * ownChatRefusals({ name: 'wiki.stage-1', writtenAtMs: 1_500, ownedPaths: [] }, { outputDirectory: '/repo/.codebook/wiki', startedAtMs: 1_000, endedAtMs: 2_000, mayAgentStillWork: true, candidateNames: ['wiki.stage-1'] }, 900_000)
 * // => [{ named: [{ kind: 'candidate', name: 'wiki.stage-1' }, { kind: 'last-run', endedAtMs: 2_000 }], reason: 'An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-1, …). Codebook waits for it until <the clock time of 902_000>. …' }]
 */
function ownChatRefusals(
  activeCandidate: WikiCandidate | undefined,
  awaitedOwnRun: WikiLastRun | undefined,
  watchTimeoutMs: number,
): WikiLeftoverRefusal[] {
  const ownRunLeftover: WikiLeftover | undefined = awaitedOwnRun && {
    kind: 'last-run',
    endedAtMs: awaitedOwnRun.endedAtMs,
  }
  const ownRunRefusal: WikiLeftoverRefusal[] =
    awaitedOwnRun && ownRunLeftover
      ? [
          {
            named: [ownRunLeftover],
            reason: `The VS Code chat this window asked at ${formatClockTime(awaitedOwnRun.startedAtMs, {})} may still be updating this Wiki; Codebook stopped watching it at ${formatClockTime(awaitedOwnRun.endedAtMs, {})} and waits for it until ${formatClockTime(awaitedOwnRun.endedAtMs + watchTimeoutMs, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
          },
        ]
      : []
  // No candidate is in the way: what is left is this window's own stopped watch, if any, in a refusal of its own.
  if (!activeCandidate) return ownRunRefusal
  const candidateLeftover: WikiLeftover = {
    kind: 'candidate',
    name: activeCandidate.name,
  }
  /** Words the candidate's refusal with the moment the start waits until. */
  const candidateReason = (waitEndsAtMs: number): string =>
    `An earlier chat or another editor window appears to be updating this Wiki (candidate ${activeCandidate.name}, written ${formatClockTime(activeCandidate.writtenAtMs, {})}). Codebook waits for it until ${formatClockTime(waitEndsAtMs, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`
  // A candidate the stopped watch saw is that watch's chat's: its refusal names the watch too, which then needs no refusal of its own. The start waits for both, so the sentence names the later end: the candidate's, or the watch's.
  if (
    awaitedOwnRun &&
    ownRunLeftover &&
    (awaitedOwnRun.candidateNames ?? []).includes(activeCandidate.name)
  )
    return [
      {
        named: [candidateLeftover, ownRunLeftover],
        reason: candidateReason(
          Math.max(activeCandidate.writtenAtMs, awaitedOwnRun.endedAtMs) +
            watchTimeoutMs,
        ),
      },
    ]
  return [
    {
      named: [candidateLeftover],
      reason: candidateReason(activeCandidate.writtenAtMs + watchTimeoutMs),
    },
    ...ownRunRefusal,
  ]
}

/**
 * Finds the first leftover of an earlier chat that is in the way of a Wiki update's start and that "Update anyway" has not passed yet, with the sentence of its refusal.
 *
 * Why: a chat that may still publish (another window's stopped watch, a recent candidate, this window's own stopped watch) would publish beside the agent a new start asks. A refusal names one chat's leftovers, and its "Update anyway" passes only those, so a press in the Notification Center minutes later does not start beside a chat that no notification named; the leftovers of two chats at once are named in two refusals, one after the other.
 * Trigger: the extension's start checks call it after another window's running update was ruled out and before the marker is claimed, once per generation of the Wiki they check.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param look.nowMs - The present (epoch milliseconds).
 * @param look.watchTimeoutMs - The watch bound: how long a stopped watch's chat and a candidate are waited for.
 * @param look.otherWindow - The marker of another window that is live, a run or a stopped watch's reservation; `undefined` when there is none.
 * @param look.lastRun - This window's last run of this output; `undefined` when it had none (the caller passes none for a record of another output).
 * @param look.acknowledged - The leftovers that "Update anyway" passed so far ({@link isAcknowledgedWikiLeftover}); empty for an ordinary press.
 * @param look.listCandidates - Lists the candidates bound to this Wiki ({@link listWikiCandidates}); the extension hands over the listing it uses for its runs' looks, so every listing of the start checks is the extension's own.
 * @returns The first refusal, in the order another window's stopped watch, the latest active candidate, this window's own stopped watch, that names a leftover not yet passed; `undefined` when every leftover in the way was passed or none is.
 * @example
 * ```ts
 * await findUnacknowledgedWikiLeftover('/repo/.codebook/wiki', { nowMs: Date.now(), watchTimeoutMs: 900_000, otherWindow: undefined, lastRun, acknowledged: [], listCandidates: listWikiCandidates })
 * // => { named: [{ kind: 'last-run', endedAtMs: 1_790_000_000_000 }], reason: 'The VS Code chat this window asked at … may still be updating this Wiki; …' }
 * ```
 */
export async function findUnacknowledgedWikiLeftover(
  outputDirectory: string,
  look: LeftoverLook,
): Promise<WikiLeftoverRefusal | undefined> {
  const reservation = await reservationRefusal(outputDirectory, look)
  const activeCandidate = selectActiveWikiCandidate(
    await look.listCandidates(outputDirectory),
    {
      nowMs: look.nowMs,
      activeWithinMs: look.watchTimeoutMs,
      lastRun: look.lastRun,
    },
  )
  const refusals = [
    ...(reservation ? [reservation] : []),
    ...ownChatRefusals(
      activeCandidate,
      await awaitedOwnRunOf(outputDirectory, look),
      look.watchTimeoutMs,
    ),
  ]
  return refusals.find(({ named }) =>
    named.some(
      (leftover) => !isAcknowledgedWikiLeftover(leftover, look.acknowledged),
    ),
  )
}
