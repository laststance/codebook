/** The start of the two sentences the shared launcher's `ready` throws when the server answers the root page or the selected entry page with a non-success status. */
const ENTRY_ANSWER_FAILURE_PATTERN =
  /^(?:Application root failed: |Selected application page failed or redirected: )/

/**
 * Tells whether a readiness failure is the server's non-success answer for the entry page, as opposed to a listener that never came up or a request that was cut.
 *
 * Why it exists: an Expo run classifies Metro's own error answer for the entry page (`EXPO_WEB_LAUNCHER_FAILED`, `bundle-failed`) before the generic readiness text reaches the learner. Called by {@link ConfiguredBrowserRun} after the shared readiness check threw.
 * @param error - What the readiness check threw.
 * @returns `true` for the launcher's "root failed" and "selected page failed or redirected" errors.
 * @example isEntryAnswerFailure(new Error('Application root failed: 500: …')) // => true
 */
export function isEntryAnswerFailure(error: unknown): boolean {
  return (
    error instanceof Error && ENTRY_ANSWER_FAILURE_PATTERN.test(error.message)
  )
}
