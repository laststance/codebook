import { randomUUID } from 'node:crypto'

import type * as vscode from 'vscode'

import type { SavedSessionManagerPort } from '../runtimeSupport/savedSessionSetupTypes'
import { SavedSessionStore } from '../runtimeSupport/signInProfile'

/**
 * Builds the one saved-session store of an editor window, or returns the one a test injected.
 *
 * Why it exists: the commands, the status item, `codebook_status` and the runs must share one store (one set of holds and listeners per window); {@link activate} calls this once before anything uses it.
 * @param context - The extension context: its global storage folder, its global state (the last sign-in paths) and an optional injected store.
 * @param editorEnv - The editor's `env`; its `sessionId` names this window in the folder locks. A stand-in without one gets a random id.
 * @returns The injected store, or a new {@link SavedSessionStore} under `<globalStorage>/sign-in-profiles`.
 * @example
 * const store = createSavedSessionStore(context, vscode.env)
 */
export function createSavedSessionStore(
  context: {
    globalStorageUri: Pick<vscode.Uri, 'fsPath'>
    globalState?: Pick<vscode.Memento, 'get' | 'update'>
    savedSessionStore?: SavedSessionManagerPort
  },
  editorEnv: Pick<typeof vscode.env, 'sessionId'> | undefined,
): SavedSessionManagerPort {
  if (context.savedSessionStore) return context.savedSessionStore
  return new SavedSessionStore({
    globalStorage: context.globalStorageUri.fsPath,
    windowSession: editorEnv?.sessionId ?? randomUUID(),
    memento: context.globalState,
  })
}
