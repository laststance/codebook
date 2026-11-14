import type * as vscode from 'vscode'

import { CODEBOOK_RUN_SESSION_NAME_PREFIX } from '../constants'

/**
 * Tells whether a debug session belongs to a Codebook run, by the configuration name of its own attach or of an ancestor's.
 * Called by the stop note of {@link StudyWorkspace} so that a session the learner started (F5 on their own launch configuration) is never taken for a run's stop.
 * @param debugSession - Any debug session of the editor.
 * @returns `true` when the session or one of its ancestors has a configuration name that starts with {@link CODEBOOK_RUN_SESSION_NAME_PREFIX}; `false` otherwise.
 * @example
 * isCodebookRunDebugSession(childOfNodeTest) // => true when its parent is 'codebook node test run-9'
 * isCodebookRunDebugSession({ configuration: { name: 'Launch Program' } }) // => false
 */
export function isCodebookRunDebugSession(
  debugSession: Pick<vscode.DebugSession, 'configuration' | 'parentSession'>,
): boolean {
  for (
    let ancestor:
      Pick<vscode.DebugSession, 'configuration' | 'parentSession'> | undefined =
      debugSession;
    ancestor;
    ancestor = ancestor.parentSession
  )
    if (
      ancestor.configuration.name.startsWith(CODEBOOK_RUN_SESSION_NAME_PREFIX)
    )
      return true
  return false
}
