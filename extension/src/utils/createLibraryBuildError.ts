import { StudyError } from '../errors'

/**
 * Makes the typed refusal or failure of the library route of a `node-script` run: the code, one sentence and the `details.reason` an agent decides its recovery by.
 * Called by {@link prepareLibraryPackage} for `LIBRARY_BUILD_UNSUPPORTED` (nothing started) and `LIBRARY_BUILD_FAILED` (the build or pack started and the script did not).
 * @param code - `LIBRARY_BUILD_UNSUPPORTED` or `LIBRARY_BUILD_FAILED`.
 * @param reason - The reason name, such as `no-build-script` or `timeout`.
 * @param sentence - The error's message.
 * @param details - Structured fields beside the reason (field path, package, command, exit code).
 * @returns The error to throw.
 * @example
 * throw createLibraryBuildError('LIBRARY_BUILD_FAILED', 'timeout', 'The library build timed out.')
 */
export function createLibraryBuildError(
  code: 'LIBRARY_BUILD_UNSUPPORTED' | 'LIBRARY_BUILD_FAILED',
  reason: string,
  sentence: string,
  details: Readonly<Record<string, unknown>> = {},
): StudyError {
  return new StudyError(code, sentence, sentence, undefined, undefined, {
    reason,
    ...details,
  })
}
