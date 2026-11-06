import { StudyError } from '../errors'
import { LibraryPackageCancelled } from '../libraryPackage'

import { removeWithoutFollowing } from './removeWithoutFollowing'

/**
 * Removes a library run's private folder after the build raised, unless the build reported that its own removal is still pending.
 *
 * Why it exists: a failed or stopped build removes its folder itself and reports `removed` or `pending`; a `pending` removal continues in the background and the run resource says so, so a second removal here would race it and make that report false. Called by the product's `prepareLibrary` when `prepareLibraryPackage` throws.
 * @param folder - The private folder the run made.
 * @param error - What the build raised.
 * @returns Resolves when the folder was removed or left to the pending removal; never rejects.
 * @example
 * await removeFolderUnlessCleanupPending('/tmp/codebook-library-run-abc', error)
 */
export async function removeFolderUnlessCleanupPending(
  folder: string,
  error: unknown,
): Promise<void> {
  const reported =
    error instanceof LibraryPackageCancelled
      ? error.cleanup
      : error instanceof StudyError
        ? error.details?.cleanup
        : undefined
  // The build's own removal is still running: leave the folder to it.
  if (reported === 'pending') return
  await removeWithoutFollowing(folder).catch(() => undefined)
}
