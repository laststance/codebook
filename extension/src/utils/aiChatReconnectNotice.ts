import { thrownMessage } from './thrownMessage'

/** The step that repairs a chat connection; a reason that already names it is not followed by it again. */
const SETUP_STEP = 'Run Codebook: Set Up AI Chat'

/**
 * Words the one notification a learner reads when the saved AI chat setup could not reconnect at editor start; called by {@link activate} when its reconnect fails.
 *
 * Why: the notice was the thrown value's string form with the setup step appended, which printed "Error:", named the step twice when the reason already gave it, and ended with two full stops. The reason is shown as its message, ends with exactly one full stop, and is followed by the setup step only when it does not name that step itself.
 *
 * @param thrown - What the reconnect threw: the skill check's refusal, a server start failure, or a changed workspace.
 * @returns The whole sentence: what happened, what Codebook found, and the step to take.
 *
 * @example
 * ```ts
 * aiChatReconnectNotice(new Error('Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'))
 * // => 'Codebook AI chat did not reconnect: Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'
 * aiChatReconnectNotice(new Error('The selected workspace changed after setup'))
 * // => 'Codebook AI chat did not reconnect: The selected workspace changed after setup. Run Codebook: Set Up AI Chat.'
 * ```
 */
export function aiChatReconnectNotice(thrown: unknown): string {
  const reason = thrownMessage(thrown)
  // A reason that already ends its sentence gets no second full stop.
  const reasonSentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
  const notice = `Codebook AI chat did not reconnect: ${reasonSentence}`
  return reason.includes(SETUP_STEP) ? notice : `${notice} ${SETUP_STEP}.`
}
