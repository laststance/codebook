import {
  MS_PER_MINUTE,
  WIKI_UPDATE_RECOVERY_REQUEST,
  WIKI_UPDATE_SHOWN_PATH_LIMIT,
} from '../constants'

import { describeWikiUpdate } from './describeWikiUpdate'
import { formatClockTime } from './formatClockTime'
import { plainNotificationText } from './plainNotificationText'
import type { WikiUpdateStatus } from './wikiUpdateRun'

/** The button of an update notification that opens the browser Wiki. */
export const OPEN_WIKI_ACTION = 'Open LLM Wiki'

/** The editor notification for one ended update: how loud it is, what it says and the buttons it offers. */
export type WikiUpdateNotice = {
  severity: 'information' | 'warning' | 'error'
  message: string
  /** Button labels; an error notification with a button stays until the learner dismisses it. */
  actions: string[]
}

/**
 * Says whether an ending asks the learner for a step; called by {@link noticeOfSentence} to decide whether the notification must stay on screen.
 * @param state - The state the update ended in.
 * @returns `true` for `failed`, `timed-out` and `conflict`; `false` for every other state.
 * @example
 * asksForStep('conflict')  // => true
 * asksForStep('cancelled') // => false
 */
function asksForStep(state: WikiUpdateStatus['state']): boolean {
  return state === 'failed' || state === 'timed-out' || state === 'conflict'
}

/**
 * Chooses how loud an ended update's notification is and which buttons it offers; called by {@link wikiUpdateNotice} with the sentence it wrote.
 * @param state - The state the update ended in.
 * @param sentence - The page's sentence as plain notification text.
 * @returns
 * - `succeeded`: an information notice that also says to reload the browser reader, without a button
 * - An ending that asks for a step ({@link asksForStep}): an error notice with the button {@link OPEN_WIKI_ACTION}
 * - Any other ending: an information notice without a button
 * @example
 * noticeOfSentence('cancelled', 'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept.')
 * // => { severity: 'information', message: 'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept.', actions: [] }
 */
function noticeOfSentence(
  state: WikiUpdateStatus['state'],
  sentence: string,
): WikiUpdateNotice {
  if (state === 'succeeded')
    return {
      severity: 'information',
      // The editor cannot reload the browser tab, so it says to.
      message: `${sentence} Reload the browser reader to read the new pages.`,
      actions: [],
    }
  // An update runs up to 15 minutes, so the learner is rarely looking when it ends: an ending that asks for a step must stay on screen.
  if (asksForStep(state))
    return { severity: 'error', message: sentence, actions: [OPEN_WIKI_ACTION] }
  return { severity: 'information', message: sentence, actions: [] }
}

/**
 * Writes the editor notification for a Wiki update that ended, from the sentence the browser Wiki shows.
 *
 * Why: a run started from the Command Palette may have no browser tab open, and a notification that words the ending differently from the page contradicts it. The sentence comes from {@link describeWikiUpdate} with two differences: link syntax in it is taken apart by {@link plainNotificationText} (`](` becomes `] (`), so the two texts differ for a path or a reason that carries it; and it points to the freshness label "in the browser reader", since the editor has none above. The page's "Output:" line is left out, and a failure reason is never shortened here.
 * Trigger: the extension calls it after every recorded ending in both hosts, also for a refused start and for "already current".
 *
 * @param status - The update state just recorded.
 * @param formatTime - Turns an ISO timestamp into the learner's local hour and minute; tests pass a fixed one.
 * @returns
 * - `succeeded`, `already-current`, `cancelled`: an information notice without a button (a success also says to reload the browser reader)
 * - `failed`, `timed-out`, `conflict`: the endings that ask the learner for a step are an error notice with the button {@link OPEN_WIKI_ACTION}, which the editor keeps until it is dismissed
 * - `idle` or `running`: undefined, since nothing ended
 *
 * @example
 * ```ts
 * wikiUpdateNotice(
 *   { state: 'cancelled', host: 'cursor', finishedAt: '2026-10-03T12:10:00.000Z', site: 'kept', outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' },
 *   () => '21:10',
 * )
 * // => { severity: 'information', message: 'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept.', actions: [] }
 * ```
 */
export function wikiUpdateNotice(
  status: WikiUpdateStatus,
  formatTime: (isoTimestamp: string) => string = formatClockTime,
): WikiUpdateNotice | undefined {
  if (status.state === 'idle' || status.state === 'running') return undefined
  const described = describeWikiUpdate(status, {
    formatTime,
    pathLimit: WIKI_UPDATE_SHOWN_PATH_LIMIT,
    // The page moves a long reason into a disclosure; a notification has none, so it keeps the whole reason and its next step.
    reasonLimitChars: Number.POSITIVE_INFINITY,
    msPerMinute: MS_PER_MINUTE,
    recoveryRequest: WIKI_UPDATE_RECOVERY_REQUEST,
    // The editor shows no freshness label; the page's is in the browser reader.
    freshnessLabelPlace: 'in the browser reader',
  })
  if (!described) return undefined
  // The sentence carries paths, a candidate's name and an agent's own failure text; none of them may become a link the editor renders.
  const sentence = plainNotificationText(described.lead + described.rest)
  return noticeOfSentence(status.state, sentence)
}
