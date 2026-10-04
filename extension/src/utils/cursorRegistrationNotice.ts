import { noticeWithSetupStep } from './noticeWithSetupStep'

/**
 * Words the one notification a Cursor learner reads when the agent server started but its chat connection could not be registered; called by {@link activate} when a start restores a saved Cursor setup and the registration fails.
 *
 * @param thrown - What the registration threw: the skill check's refusal, a missing external Node.js, or a Cursor without the registration API.
 * @returns The whole sentence: the server runs, why the chat connection is missing, and the step that repairs it (named once).
 *
 * @example
 * ```ts
 * cursorRegistrationNotice(new Error('Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'))
 * // => 'Codebook agent server started, but Cursor MCP registration failed: Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.'
 * cursorRegistrationNotice(new Error('Expected an absolute external Node.js >=24 executable, not Electron.'))
 * // => 'Codebook agent server started, but Cursor MCP registration failed: Expected an absolute external Node.js >=24 executable, not Electron. Run Codebook: Set Up AI Chat to repair the connection.'
 * ```
 */
export function cursorRegistrationNotice(thrown: unknown): string {
  return noticeWithSetupStep(
    'Codebook agent server started, but Cursor MCP registration failed',
    thrown,
    'Run Codebook: Set Up AI Chat to repair the connection.',
  )
}
