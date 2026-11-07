import { StudyError } from '../errors'

/**
 * Says whether an error is a library build failure about the repository's tracked files (`tracked-file-changed` or `tracked-files-unverified`).
 *
 * Why it exists: a stop normally drops the preparation's error because the run ended as stopped, but these two failures say the build may have changed the learner's files, so the run keeps them as its final error (D21).
 * Called by the service's `node-script` preparation when a stop is under way or done.
 * @param error - What the preparation rejected with.
 * @returns `true` for `LIBRARY_BUILD_FAILED` with one of those two reasons.
 * @example
 * isTrackedFileBuildFailure(createLibraryBuildError('LIBRARY_BUILD_FAILED', 'tracked-file-changed', 'x')) // => true
 */
export function isTrackedFileBuildFailure(error: unknown): error is StudyError {
  return (
    error instanceof StudyError &&
    error.code === 'LIBRARY_BUILD_FAILED' &&
    (error.details?.reason === 'tracked-file-changed' ||
      error.details?.reason === 'tracked-files-unverified')
  )
}
