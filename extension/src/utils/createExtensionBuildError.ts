import { StudyError } from '../errors'

/**
 * Makes the typed refusal of a `wxt-build` run: the code, one sentence and `details.reason` an agent decides its recovery by.
 * Called by {@link assertWxtBuildSupported} (`EXTENSION_BUILD_UNSUPPORTED`, nothing started) and {@link buildWxtExtension} (`EXTENSION_BUILD_FAILED`, the build started).
 * @param code - `EXTENSION_BUILD_UNSUPPORTED` or `EXTENSION_BUILD_FAILED`.
 * @param reason - The reason name, such as `wxt-version` or `timeout`.
 * @param sentence - The refusal's message.
 * @param details - Structured fields beside the reason (version, path, exit code).
 * @returns The error to throw.
 * @example
 * throw createExtensionBuildError('EXTENSION_BUILD_FAILED', 'timeout', 'The build timed out.')
 */
export function createExtensionBuildError(
  code: 'EXTENSION_BUILD_UNSUPPORTED' | 'EXTENSION_BUILD_FAILED',
  reason: string,
  sentence: string,
  details: Readonly<Record<string, unknown>> = {},
): StudyError {
  return new StudyError(code, sentence, sentence, undefined, undefined, {
    reason,
    ...details,
  })
}
