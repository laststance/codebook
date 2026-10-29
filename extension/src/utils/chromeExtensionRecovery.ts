import { MILLISECONDS_PER_SECOND } from '../constants'

/**
 * The recovery sentences of the shared error codes the chrome-extension debugger reuses, worded for an extension run.
 * Exists because `ERROR_RECOVERY` words `PAUSE_HOLD_EXPIRED`, `LEARNER_PAUSED` and `SOURCE_CHANGED` for a node server or a repository-browser run (server, 300 s, node-server anchor); the chrome-extension debugger passes these as the `StudyError` recovery override.
 */
export const CHROME_EXTENSION_RECOVERY = {
  /**
   * The recovery of a pause held past its limit.
   * @param holdMs - The hold that expired: 300 s for a page stop, 280 s for a service-worker stop.
   * @returns The recovery text naming the extension and the actual hold.
   * @example
   * CHROME_EXTENSION_RECOVERY.pauseHoldExpired(280_000) // => 'Tell the learner the extension stayed paused longer than 280 s, …'
   */
  pauseHoldExpired: (holdMs: number): string =>
    `Tell the learner the extension stayed paused longer than ${holdMs / MILLISECONDS_PER_SECOND} s, so Codebook ended the run without resuming the paused code. Recovery: learner decision, at most one new run. The run is stopped and its owned browser closed; whether the click changed the extension's data is unknown, so have the learner check it. Start one new run with a new key only if the learner asks, and continue each stop within the hold. See codebook://help/chrome-extension#PAUSE_HOLD_EXPIRED.`,
  learnerPaused:
    "Let the learner continue the extension in the editor's debugger: the learner paused it, and Codebook never resumes such a pause. Recovery: learner action. Nothing changed. Read the run again after the learner continues; stop the run only if the learner asks. See codebook://help/chrome-extension#LEARNER_PAUSED.",
  sourceChanged:
    'A source file of the extension changed after the run started, so the run ends and no resume was sent. Earlier observations and their captured source stay readable. Ask the learner to save or revert the file the message names, then start a new deliberate run. Never retry the click automatically. See codebook://help/chrome-extension#SOURCE_CHANGED.',
} as const
