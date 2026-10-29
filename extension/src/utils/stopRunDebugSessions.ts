import type * as vscode from 'vscode'

import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'

/**
 * Ends every debug session a run started, forgets them in the stop ledger, and reports the first session the editor could not stop.
 * Called from the node-server and chrome-extension debuggers' release, which may run it again after a failure.
 * @param sessions - The run's own debug sessions.
 * @param stopDebugging - The editor's `vscode.debug.stopDebugging`, passed in so the caller's module keeps the only `vscode` import.
 * @throws The editor's error for the first session that did not stop; every other session was still asked to stop.
 * @example
 * await stopRunDebugSessions([rootSession, pageSession], vscode.debug.stopDebugging)
 */
export async function stopRunDebugSessions(
  sessions: readonly vscode.DebugSession[],
  stopDebugging: (session: vscode.DebugSession) => Thenable<void>,
): Promise<void> {
  const results = await Promise.allSettled(
    sessions.map((session) => stopDebugging(session)),
  )
  for (const session of sessions) codebookStopLedger.forget(session.id)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
