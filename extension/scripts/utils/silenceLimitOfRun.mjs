import { PACKAGE_COMMAND_TIMEOUT_MS } from './packageConstants.mjs'
import { CALL_SILENCE_TIMEOUT_MS } from './testShardConstants.mjs'

/**
 * Chooses how long a run of the pre-gate may print nothing before it is ended as hung.
 *
 * Why: the `before` hook of `package.test.mjs` builds the package and prints nothing until the build ends, which may take {@link PACKAGE_COMMAND_TIMEOUT_MS} for one command; the ordinary limit ({@link CALL_SILENCE_TIMEOUT_MS}) would fail a valid build of 121 to 180 s. The hook writes a progress line at an interval while the build runs ({@link writeProgressWhileRunning}), so only a blocking Git call of the build, at most one command limit, leaves the run silent. A run that holds the test may therefore be silent for the build's limit plus the ordinary limit, so a build that hits its own limit is reported by the test and not as a hang.
 * Called by `run-pregate-tests.mjs` for each run of {@link planPregateRuns}.
 *
 * @param files - The absolute paths of the run's test files.
 * @param explicitSilenceMs - The limit the caller gave with `--silence-seconds`, in milliseconds, or `undefined`. A limit the caller gave is kept for every run as given.
 * @returns The silence limit of the run in milliseconds.
 *
 * @example
 * ```js
 * silenceLimitOfRun(['/repo/extension/dist/tests/a.test.js'], undefined) // => 120000
 * silenceLimitOfRun(['/repo/extension/scripts/tests/package.test.mjs'], undefined) // => 300000
 * silenceLimitOfRun(['/repo/extension/scripts/tests/package.test.mjs'], 3000) // => 3000
 * ```
 */
export function silenceLimitOfRun(files, explicitSilenceMs) {
  if (explicitSilenceMs !== undefined) return explicitSilenceMs
  const holdsPackageTest = files.some(
    (file) =>
      file.replaceAll('\\', '/').split('/').pop() === 'package.test.mjs',
  )
  return holdsPackageTest
    ? PACKAGE_COMMAND_TIMEOUT_MS + CALL_SILENCE_TIMEOUT_MS
    : CALL_SILENCE_TIMEOUT_MS
}
