import { WSL_REMOTE_NAME } from '../constants'

import type { StudyRemovalAvailability } from './fullLibraryMessage'

/**
 * Tells whether a window can remove a saved study before it tried a removal; called by {@link StudyService} when it is constructed and by {@link StudyWorkspace} while no service is attached.
 * The editor's Trash is the only mover Codebook uses, and a WSL remote window has none for its files, so a removal there is never started and nothing is deleted for good in its place.
 * @param remoteName - `vscode.env.remoteName` of the window; `undefined` or empty in a local window.
 * @returns
 * - `no-trash` in a WSL remote window
 * - `available` in a local window
 * @example
 * initialStudyRemovalAvailability(undefined) // => 'available'
 * initialStudyRemovalAvailability('wsl')     // => 'no-trash'
 */
export function initialStudyRemovalAvailability(
  remoteName: string | undefined,
): StudyRemovalAvailability {
  return remoteName === WSL_REMOTE_NAME ? 'no-trash' : 'available'
}
