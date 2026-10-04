import { WIKI_UPDATE_SHOWN_PATH_LIMIT } from '../constants'

import { describeWikiUpdate } from './describeWikiUpdate'
import { formatClockTime } from './formatClockTime'
import { plainNotificationText } from './plainNotificationText'
import type { WikiUpdateStatus } from './wikiUpdateRun'

/** The editor notification for one ended update: how loud it is and what it says. */
export type WikiUpdateNotice = {
  severity: 'information' | 'warning' | 'error'
  message: string
}

/**
 * Writes the editor notification for a Wiki update that ended, with the same sentence the browser Wiki shows.
 *
 * Why: a run started from the Command Palette may have no browser tab open, and a notification that words the ending differently from the page contradicts it. The sentence comes from {@link describeWikiUpdate}; the page's "Output:" line is left out, and a failure reason is never shortened here.
 * Trigger: the extension calls it after every recorded ending in both hosts, also for a refused start and for "already current".
 *
 * @param status - The update state just recorded.
 * @param formatTime - Turns an ISO timestamp into the learner's local hour and minute; tests pass a fixed one.
 * @returns
 * - `succeeded`, `already-current`, `cancelled`: an information notice (a success also says to reload the browser reader)
 * - `timed-out`, `conflict`: a warning
 * - `failed`: an error
 * - `idle` or `running`: undefined, since nothing ended
 *
 * @example
 * ```ts
 * wikiUpdateNotice(
 *   { state: 'cancelled', host: 'cursor', finishedAt: '2026-10-03T12:10:00.000Z', site: 'kept', outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' },
 *   () => '21:10',
 * )
 * // => { severity: 'information', message: 'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept.' }
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
  })
  if (!described) return undefined
  // The sentence carries paths, a candidate's name and an agent's own failure text; none of them may become a link the editor renders.
  const sentence = plainNotificationText(described.lead + described.rest)
  if (status.state === 'succeeded')
    return {
      severity: 'information',
      // The editor cannot reload the browser tab, so it says to.
      message: `${sentence} Reload the browser reader to read the new pages.`,
    }
  if (status.state === 'failed') return { severity: 'error', message: sentence }
  return {
    severity:
      status.state === 'timed-out' || status.state === 'conflict'
        ? 'warning'
        : 'information',
    message: sentence,
  }
}
