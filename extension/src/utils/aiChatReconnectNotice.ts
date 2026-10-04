import { noticeWithSetupStep } from './noticeWithSetupStep'

/**
 * Words the one notification a learner reads when the saved AI chat setup could not reconnect at editor start; called by {@link activate} when its reconnect fails.
 *
 * The sentence is built by {@link noticeWithSetupStep}: the reason without "Error:", one full stop, and the setup step only when the reason does not name it itself.
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
  return noticeWithSetupStep(
    'Codebook AI chat did not reconnect',
    thrown,
    'Run Codebook: Set Up AI Chat.',
  )
}
