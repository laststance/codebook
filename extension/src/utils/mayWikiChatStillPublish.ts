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
 * @param wasChatLeftAtWork - Whether the run's own end says its chat was not stopped: a watch that threw while the chat worked, or a request Codebook could not take back at the 30 seconds.
 * @returns For such a run: `true` only when it ended as `failed`, not when its end found the chat's publish. Otherwise `true` for a watch that was cancelled, timed out or ended on a learner's file ({@link STOPPED_WATCH_STATES}).
 * @example
 * didWatchStopBeforeChat('failed', true)     // => true
 * didWatchStopBeforeChat('failed', false)    // => false
 * didWatchStopBeforeChat('timed-out', false) // => true
 * didWatchStopBeforeChat('conflict', false)  // => true
 */
function didWatchStopBeforeChat(
  endState: WikiUpdateEnd['state'],
  wasChatLeftAtWork: boolean,
): boolean {
  return wasChatLeftAtWork
    ? endState === 'failed'
    : STOPPED_WATCH_STATES.includes(endState)
}

/**
 * Says whether the chat of an ended Wiki update may still publish; called by the extension when it records a run's end, to decide whether the next press is held back and whether the run's marker stays as a reservation for other windows.
 *
 * Why: stopping a VS Code watch does not stop the chat it watched, so a cancelled or timed-out watch leaves a chat that can still publish, and so do a watch that ended because a file of the learner's is in the way (the chat publishes once the file is moved) a watch that broke off with an error while the chat worked, and a start whose request Codebook could not take back, which may still be in the chat. A second chat beside it is what the reservation prevents. A Cursor agent is stopped with its run, and a window that closes or reloads takes its chat with it.
 *
 * @param host - Editor host that ran the update.
 * @param endState - The state the run ended in.
 * @param isWindowClosing - Whether the editor window is closing or reloading.
 * @param wasChatLeftAtWork - Whether the run's own end says its chat was not stopped: the watch itself threw while the chat worked, or Codebook could not take its request back at the 30 seconds (the request may still be in the chat); such a run ends as `failed`.
 * @returns `true` only for a VS Code update in a window that stays open whose watch was cancelled, timed out, ended as a conflict over a learner's file or broke off and ended as failed, or whose request could not be taken back; `false` otherwise, also for every other failed end.
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
  wasChatLeftAtWork: boolean,
): boolean {
  return (
    host === 'vscode' &&
    !isWindowClosing &&
    didWatchStopBeforeChat(endState, wasChatLeftAtWork)
  )
}
