import type * as vscode from 'vscode'

/**
 * Tells whether a debug session is a run's own attach or a child of it, by the name of the root attach session the run started.
 * Called by the owned Node test run and the node-server debugger for every session the editor's tracker offers.
 * @param debugSession - Any debug session of the editor.
 * @param rootName - The configuration name the run gave its attach (`codebook node test <runId>`, `codebook node server <runId>`).
 * @returns `true` when the session or one of its ancestors carries that name; `false` for every session of a debugger the learner started.
 * @example
 * isDebugSessionOfRun(childSession, 'codebook node server run-9') // => true when its parent is the run's attach
 */
export function isDebugSessionOfRun(
  debugSession: Pick<vscode.DebugSession, 'configuration' | 'parentSession'>,
  rootName: string,
): boolean {
  for (
    let ancestor:
      Pick<vscode.DebugSession, 'configuration' | 'parentSession'> | undefined =
      debugSession;
    ancestor;
    ancestor = ancestor.parentSession
  )
    if (ancestor.configuration.name === rootName) return true
  return false
}
