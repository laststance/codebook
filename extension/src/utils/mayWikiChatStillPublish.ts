import type { WikiUpdateEnd, WikiUpdateHost } from './wikiUpdateRun'

/** The states a VS Code watch ends in while its chat goes on: the learner's Cancel, the bound, and a file of the learner's in the way of the candidate the chat staged. */
const STOPPED_WATCH_STATES: ReadonlyArray<WikiUpdateEnd['state']> = [
  'cancelled',
  'timed-out',
  'conflict',
]

/**
 * Says whether a VS Code watch ended while its chat was still at work; called by {@link mayWikiChatStillPublish} for a window that stays open.
 * @param endState - The state the run ended in.
 * @param didWatchBreak - Whether the watch itself threw while the chat worked.
 * @returns For a watch that broke off: `true` only when its run ended as `failed`, not when it ended with the chat's publish. Otherwise `true` for a watch that was cancelled, timed out or ended on a learner's file ({@link STOPPED_WATCH_STATES}).
 * @example
 * didWatchStopBeforeChat('failed', true)     // => true
 * didWatchStopBeforeChat('failed', false)    // => false
 * didWatchStopBeforeChat('timed-out', false) // => true
 * didWatchStopBeforeChat('conflict', false)  // => true
 */
function didWatchStopBeforeChat(
  endState: WikiUpdateEnd['state'],
  didWatchBreak: boolean,
): boolean {
  return didWatchBreak
    ? endState === 'failed'
    : STOPPED_WATCH_STATES.includes(endState)
}

/**
 * Says whether the chat of an ended Wiki update may still publish; called by the extension when it records a run's end, to decide whether the next press is held back and whether the run's marker stays as a reservation for other windows.
 *
 * Why: stopping a VS Code watch does not stop the chat it watched, so a cancelled or timed-out watch leaves a chat that can still publish, and so do a watch that ended because a file of the learner's is in the way (the chat publishes once the file is moved) and a watch that broke off with an error while the chat worked. A second chat beside it is what the reservation prevents. A Cursor agent is stopped with its run, and a window that closes or reloads takes its chat with it.
 *
 * @param host - Editor host that ran the update.
 * @param endState - The state the run ended in.
 * @param isWindowClosing - Whether the editor window is closing or reloading.
 * @param didWatchBreak - Whether the watch itself threw while the chat worked; its run ends as `failed`.
 * @returns `true` only for a VS Code watch in a window that stays open that was cancelled, timed out, ended as a conflict over a learner's file, or broke off and ended as failed; `false` otherwise, also for every other failed end.
 * @example
 * mayWikiChatStillPublish('vscode', 'cancelled', false, false) // => true
 * mayWikiChatStillPublish('vscode', 'failed', false, true)     // => true
 * mayWikiChatStillPublish('vscode', 'failed', false, false)    // => false
 * mayWikiChatStillPublish('vscode', 'cancelled', true, false)  // => false
 * mayWikiChatStillPublish('cursor', 'timed-out', false, false) // => false
 */
export function mayWikiChatStillPublish(
  host: WikiUpdateHost,
  endState: WikiUpdateEnd['state'],
  isWindowClosing: boolean,
  didWatchBreak: boolean,
): boolean {
  return (
    host === 'vscode' &&
    !isWindowClosing &&
    didWatchStopBeforeChat(endState, didWatchBreak)
  )
}
