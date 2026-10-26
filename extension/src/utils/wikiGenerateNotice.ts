import {
  GENERATE_WIKI_ACTION,
  OPEN_WIKI_IN_BROWSER_ACTION,
  UPDATE_WIKI_ACTION,
  WIKI_UPDATE_SHOWN_PATH_LIMIT,
} from '../constants'

import { describeMinutes } from './describeMinutes'
import { formatClockTime } from './formatClockTime'
import { plainNotificationText } from './plainNotificationText'
import type { WikiUpdateStatus } from './wikiUpdateRun'

/** The editor notification for one ended generation: how loud it is, what it says and the buttons it offers. */
export type WikiGenerateNotice = {
  severity: 'information' | 'warning' | 'error'
  message: string
  /** Button labels; an error notification with a button stays until the learner dismisses it. */
  actions: string[]
}

/** What a VS Code chat that Codebook stopped watching may still do, and where the learner stops it; every VS Code generation that ends without its publication says it. */
const CHAT_MAY_STILL_PUBLISH =
  ' The chat may still publish; Codebook: Open LLM Wiki in Browser opens the Wiki once it does. To stop it, stop the request in the chat.'

/**
 * Words a generation that published; called by {@link wikiGenerateNotice} for `succeeded`.
 * @param succeeded - The succeeded state.
 * @returns An information notice with Open in Browser; where sources changed while it worked, it says how many and offers Update LLM Wiki first.
 * @example
 * succeededNotice({ …succeeded, outputLabel: '.codebook/wiki' }) // => { severity: 'information', message: 'LLM Wiki generated in .codebook/wiki.', actions: ['Open in Browser'] }
 */
function succeededNotice(
  succeeded: Extract<WikiUpdateStatus, { state: 'succeeded' }>,
): WikiGenerateNotice {
  const count = succeeded.changedSourceCount
  // A usable Wiki that is already behind the source says so, and offers the update first.
  if (count)
    return {
      severity: 'information',
      message: `LLM Wiki generated in ${succeeded.outputLabel}. ${count} source ${count === 1 ? 'file' : 'files'} changed while it was written.`,
      actions: [UPDATE_WIKI_ACTION, OPEN_WIKI_IN_BROWSER_ACTION],
    }
  return {
    severity: 'information',
    message: `LLM Wiki generated in ${succeeded.outputLabel}.`,
    actions: [OPEN_WIKI_IN_BROWSER_ACTION],
  }
}

/**
 * Words a generation the learner stopped; called by {@link wikiGenerateNotice} for `cancelled`.
 * @param cancelled - The cancelled state.
 * @param at - When it ended, as the learner's local time.
 * @returns An information notice: in VS Code that Codebook stopped watching and the chat may still publish; in Cursor that the agent was stopped. A Wiki published before the stop is named, with Open in Browser.
 * @example
 * cancelledNotice({ …cancelled, host: 'cursor', site: 'kept' }, '21:10') // => { severity: 'information', message: 'LLM Wiki generation cancelled at 21:10. Cursor Agent was stopped; nothing was published.', actions: [] }
 */
function cancelledNotice(
  cancelled: Extract<WikiUpdateStatus, { state: 'cancelled' }>,
  at: string,
): WikiGenerateNotice {
  // A publication that landed before the stop is a usable Wiki, which no run claims.
  if (cancelled.site === 'replaced')
    return {
      severity: 'information',
      // One verb per host, as in the sibling notice below: VS Code stopped watching, Cursor cancelled.
      message:
        cancelled.host === 'cursor'
          ? `The LLM Wiki generation was cancelled at ${at}, after an LLM Wiki was published in ${cancelled.outputLabel}.`
          : `Codebook stopped watching the LLM Wiki generation at ${at}, after an LLM Wiki was published in ${cancelled.outputLabel}.`,
      actions: [OPEN_WIKI_IN_BROWSER_ACTION],
    }
  return {
    severity: 'information',
    message:
      cancelled.host === 'cursor'
        ? `LLM Wiki generation cancelled at ${at}. Cursor Agent was stopped; nothing was published.`
        : `Codebook stopped watching the LLM Wiki generation at ${at}.${CHAT_MAY_STILL_PUBLISH}`,
    actions: [],
  }
}

/**
 * Words a generation whose bound passed; called by {@link wikiGenerateNotice} for `timed-out`.
 * @param timedOut - The timed-out state.
 * @returns An error notice that names the bound in minutes: in VS Code that the chat may still publish, without a button, since a new start waits for that chat; in Cursor that the agent was stopped, with Generate LLM Wiki. A Wiki published before the bound is named in an information notice, with Open in Browser.
 * @example
 * timedOutNotice({ …timedOut, host: 'cursor', timeoutMs: 3_300_000 }) // => { severity: 'error', message: 'Codebook stopped waiting for the LLM Wiki generation after 55 minutes. Cursor Agent was stopped; nothing was published.', actions: ['Generate LLM Wiki'] }
 */
function timedOutNotice(
  timedOut: Extract<WikiUpdateStatus, { state: 'timed-out' }>,
): WikiGenerateNotice {
  const bound = describeMinutes(timedOut.timeoutMs)
  // A publication that landed before the bound (the Cursor agent goes on after it publishes) is a usable Wiki, which no run claims.
  if (timedOut.site === 'replaced')
    return {
      severity: 'information',
      message: `Codebook stopped waiting for the LLM Wiki generation after ${bound}, after an LLM Wiki was published in ${timedOut.outputLabel}.`,
      actions: [OPEN_WIKI_IN_BROWSER_ACTION],
    }
  const lead = `Codebook stopped waiting for the LLM Wiki generation after ${bound}.`
  if (timedOut.host === 'cursor')
    return {
      severity: 'error',
      message: `${lead} Cursor Agent was stopped; nothing was published.`,
      actions: [GENERATE_WIKI_ACTION],
    }
  return {
    severity: 'error',
    message: `${lead}${CHAT_MAY_STILL_PUBLISH}`,
    actions: [],
  }
}

/**
 * Words a generation stopped by files the publisher will not overwrite; called by {@link wikiGenerateNotice} for `conflict`.
 * @param conflict - The conflict state.
 * @param at - When it ended, as the learner's local time.
 * @returns An error notice that names the first {@link WIKI_UPDATE_SHOWN_PATH_LIMIT} paths and counts the rest, with Generate LLM Wiki.
 * @example
 * conflictNotice({ …conflict, paths: ['notes.md'], outputLabel: '.codebook/wiki' }, '21:10').message
 * // => 'LLM Wiki generation stopped at 21:10: the Wiki folder holds files the publisher will not overwrite (notes.md). Move them out of .codebook/wiki, then press Generate LLM Wiki again.'
 */
function conflictNotice(
  conflict: Extract<WikiUpdateStatus, { state: 'conflict' }>,
  at: string,
): WikiGenerateNotice {
  const named = conflict.paths.slice(0, WIKI_UPDATE_SHOWN_PATH_LIMIT).join(', ')
  const more = conflict.paths.length - WIKI_UPDATE_SHOWN_PATH_LIMIT
  return {
    severity: 'error',
    message: `LLM Wiki generation stopped at ${at}: the Wiki folder holds files the publisher will not overwrite (${named}${more > 0 ? ` and ${more} more` : ''}). Move them out of ${conflict.outputLabel}, then press Generate LLM Wiki again.`,
    actions: [GENERATE_WIKI_ACTION],
  }
}

/**
 * Words a generation that failed; called by {@link wikiGenerateNotice} for `failed`.
 * @param failed - The failed state.
 * @param at - When it ended, as the learner's local time.
 * @returns An error notice with the whole reason; Generate LLM Wiki where nothing was published, no button where a publication is there (the reason names its recovery) or the chat may still publish.
 * @example
 * failedNotice({ …failed, reason: 'Cursor Agent stopped with exit code 1 before finishing. …', site: 'kept' }, '21:10').actions // => ['Generate LLM Wiki']
 */
function failedNotice(
  failed: Extract<WikiUpdateStatus, { state: 'failed' }>,
  at: string,
): WikiGenerateNotice {
  // Pressing Generate again helps only where nothing was published and no chat may still publish.
  const mayRetry = failed.site !== 'replaced' && !failed.mayBeReplacedLater
  return {
    severity: 'error',
    message: `LLM Wiki generation failed at ${at}: ${failed.reason.trim()}`,
    actions: mayRetry ? [GENERATE_WIKI_ACTION] : [],
  }
}

/**
 * Writes the editor notification for an LLM Wiki generation that ended (Cycle 0055, D5: a generation's words never call it an update).
 *
 * Why: a generation runs in a project that has no Wiki page yet, so the editor notification is where the learner reads how it ended; the update's page sentences ({@link describeWikiUpdate}) name an update and its button. Each sentence names what was left and the next step, and the buttons start that step. Link syntax in it is taken apart ({@link plainNotificationText}), as a path or an agent's reason may carry it.
 * Trigger: the extension calls it after a generation's end was recorded ({@link WikiUpdateRun.end}).
 *
 * @param status - The state just recorded, of a run marked `runKind: 'generate'`.
 * @param formatTime - Turns an ISO timestamp into the learner's local hour and minute; tests pass a fixed one.
 * @returns
 * - `succeeded`: an information notice with Open in Browser, and with the count of changed sources and Update LLM Wiki where the Wiki is already behind the source
 * - `cancelled`: an information notice ({@link cancelledNotice})
 * - `timed-out`, `conflict`, `failed`: an error notice that names the next step, with Generate LLM Wiki where pressing it again can help
 * - Any other state, and a state of an update: undefined
 * @example
 * ```ts
 * wikiGenerateNotice({ state: 'succeeded', runKind: 'generate', host: 'cursor', finishedAt: '2026-10-26T04:34:49.000Z', identity: '1936e4191372+0f9e8d7c', revision: '1936e4191372', index: '0f9e8d7c', outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' })
 * // => { severity: 'information', message: 'LLM Wiki generated in .codebook/wiki.', actions: ['Open in Browser'] }
 * ```
 */
export function wikiGenerateNotice(
  status: WikiUpdateStatus,
  formatTime: (isoTimestamp: string) => string = formatClockTime,
): WikiGenerateNotice | undefined {
  if (
    status.state === 'idle' ||
    status.state === 'running' ||
    status.state === 'already-current' ||
    status.runKind !== 'generate'
  )
    return undefined
  const notice = noticeOfEnd(status, formatTime(status.finishedAt))
  // The sentence carries paths and an agent's own failure text; none of them may become a link the editor renders.
  return { ...notice, message: plainNotificationText(notice.message) }
}

/**
 * Picks the words of one ended generation by its state; called by {@link wikiGenerateNotice}.
 * @param ended - The ended state of a generation.
 * @param at - When it ended, as the learner's local time.
 * @returns The notice of the state's own function.
 * @example noticeOfEnd(cancelled, '21:10').severity // => 'information'
 */
function noticeOfEnd(
  ended: Exclude<
    WikiUpdateStatus,
    { state: 'idle' | 'running' | 'already-current' }
  >,
  at: string,
): WikiGenerateNotice {
  switch (ended.state) {
    case 'succeeded':
      return succeededNotice(ended)
    case 'cancelled':
      return cancelledNotice(ended, at)
    case 'timed-out':
      return timedOutNotice(ended)
    case 'conflict':
      return conflictNotice(ended, at)
    default:
      return failedNotice(ended, at)
  }
}
