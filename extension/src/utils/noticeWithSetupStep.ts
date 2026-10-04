import { thrownMessage } from './thrownMessage'

/** The step that repairs a chat connection; a reason that already names it is not followed by it again. */
const SETUP_STEP = 'Run Codebook: Set Up AI Chat'

/**
 * Words a notification about a failed chat connection as one sentence each for what happened, what Codebook found and what the learner does next; called by {@link aiChatReconnectNotice} and {@link cursorRegistrationNotice}.
 *
 * Why: such a notice used to be the thrown value's string form with the setup step appended, which printed "Error:", named the step twice when the reason already gave it, and ended with two full stops. The reason is shown as its message, ends with exactly one full stop, and is followed by the setup step only when it does not name that step itself.
 *
 * @param whatHappened - The notice's opening, without a colon or full stop.
 * @param thrown - What the failed connection threw; its message is the reason.
 * @param setupStepSentence - The closing sentence that sends the learner to Codebook: Set Up AI Chat, with its full stop.
 * @returns
 * - A reason that names the setup step: `<whatHappened>: <reason>`
 * - Any other reason: `<whatHappened>: <reason>. <setupStepSentence>`, with one full stop after the reason
 *
 * @example
 * ```ts
 * noticeWithSetupStep('Codebook AI chat did not reconnect', new Error('The selected workspace changed after setup'), 'Run Codebook: Set Up AI Chat.')
 * // => 'Codebook AI chat did not reconnect: The selected workspace changed after setup. Run Codebook: Set Up AI Chat.'
 * ```
 */
export function noticeWithSetupStep(
  whatHappened: string,
  thrown: unknown,
  setupStepSentence: string,
): string {
  const reason = thrownMessage(thrown)
  // A reason that already ends its sentence gets no second full stop.
  const reasonSentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
  const notice = `${whatHappened}: ${reasonSentence}`
  return reason.includes(SETUP_STEP) ? notice : `${notice} ${setupStepSentence}`
}
