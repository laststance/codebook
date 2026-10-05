import type { WikiUpdateEnd, WikiUpdateHost } from './wikiUpdateRun'

/**
 * Says whether the chat of an ended Wiki update may still publish; called by the extension when it records a run's end, to decide whether the next press is held back and whether the run's marker stays as a reservation for other windows.
 *
 * Why: stopping a VS Code watch does not stop the chat it watched, so a cancelled or timed-out watch leaves a chat that can still publish. A Cursor agent is stopped with its run, and a window that closes or reloads takes its chat with it.
 *
 * @param host - Editor host that ran the update.
 * @param endState - The state the run ended in.
 * @param isWindowClosing - Whether the editor window is closing or reloading.
 * @returns `true` only for a VS Code watch that was cancelled or timed out in a window that stays open; `false` otherwise.
 * @example
 * mayWikiChatStillPublish('vscode', 'cancelled', false) // => true
 * mayWikiChatStillPublish('vscode', 'cancelled', true)  // => false
 * mayWikiChatStillPublish('cursor', 'timed-out', false) // => false
 */
export function mayWikiChatStillPublish(
  host: WikiUpdateHost,
  endState: WikiUpdateEnd['state'],
  isWindowClosing: boolean,
): boolean {
  return (
    host === 'vscode' &&
    !isWindowClosing &&
    (endState === 'cancelled' || endState === 'timed-out')
  )
}
