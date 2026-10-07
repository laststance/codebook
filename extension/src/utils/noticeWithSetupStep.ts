import { SET_UP_AI_CHAT_COMMAND } from './startOverBy'
import { thrownMessage } from './thrownMessage'

/** A reason that tells the learner to run a command of Codebook's, as the sentences of a server that was stopped while it started do ("Run Codebook: Start Agent Server to start it."): that command is the step, and the setup is not named after it. */
const NAMES_A_COMMAND_TO_RUN = /\b[Rr]un Codebook: /

/**
 * Words a notification about a failed chat connection as one sentence each for what happened, what Codebook found and what the learner does next; called by {@link activate} when the saved AI chat setup does not reconnect at editor start, and when a start restores a saved Cursor setup and the chat connection cannot be registered.
 *
 * Why: such a notice used to be the thrown value's string form with the setup step appended, which printed "Error:", named the step twice when the reason already gave it, and ended with two full stops. The reason is shown as its message, ends with exactly one full stop, and is followed by the setup step only when it names no step of its own: neither the setup command ({@link SET_UP_AI_CHAT_COMMAND}), however its sentence is written, nor another command to run ({@link NAMES_A_COMMAND_TO_RUN}); the setup command is recognized in both forms: "Run Codebook: Set Up AI Chat; …" as well as "…, then run Codebook: Set Up AI Chat again.", with which the refusals of the Cursor setup end.
 *
 * @param whatHappened - The notice's opening, without a colon or full stop.
 * @param thrown - What the failed connection threw (the skill check's refusal, a server start failure, a changed workspace, a missing external Node.js); its message is the reason, and a value that is no error is shown as its text.
 * @param setupStepSentence - The closing sentence that sends the learner to Codebook: Set Up AI Chat, with its full stop.
 * @returns
 * - A reason that names the setup command, or that tells the learner to run another command ({@link NAMES_A_COMMAND_TO_RUN}): `<whatHappened>: <reason>`
 * - Any other reason: `<whatHappened>: <reason>. <setupStepSentence>`, with one full stop after the reason
 *
 * @example
 * ```ts
 * noticeWithSetupStep('Codebook AI chat did not reconnect', new Error('The selected workspace changed after setup'), 'Run Codebook: Set Up AI Chat.')
 * // => 'Codebook AI chat did not reconnect: The selected workspace changed after setup. Run Codebook: Set Up AI Chat.'
 * noticeWithSetupStep('Codebook agent server started, but Cursor MCP registration failed', new Error('Cursor skill is missing or was changed: /home/user/.cursor/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'), 'Run Codebook: Set Up AI Chat to repair the connection.')
 * // => 'Codebook agent server started, but Cursor MCP registration failed: Cursor skill is missing or was changed: /home/user/.cursor/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'
 * noticeWithSetupStep('Codebook AI chat did not reconnect', new Error('Codebook will not read through a link: /home/user/.cursor/skills/codebook/SKILL.md. Remove the link, then run Codebook: Set Up AI Chat again.'), 'Run Codebook: Set Up AI Chat.')
 * // => 'Codebook AI chat did not reconnect: Codebook will not read through a link: /home/user/.cursor/skills/codebook/SKILL.md. Remove the link, then run Codebook: Set Up AI Chat again.'
 * noticeWithSetupStep('Codebook AI chat did not reconnect', new Error('Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.'), 'Run Codebook: Set Up AI Chat.')
 * // => 'Codebook AI chat did not reconnect: Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.'
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
  // A reason that names the setup command, or tells the learner to run another command, says the step itself, in its own words.
  return reason.includes(SET_UP_AI_CHAT_COMMAND) ||
    NAMES_A_COMMAND_TO_RUN.test(reason)
    ? notice
    : `${notice} ${setupStepSentence}`
}
