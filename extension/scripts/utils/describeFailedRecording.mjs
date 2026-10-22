import { MAX_NAMED_FAILED_TESTS } from './testShardConstants.mjs'

/**
 * Says in one line which tests failed in a timings recording, or `undefined` when none did.
 *
 * Why: the recording refuses a run with failed tests, and a refusal that only counts them sends the reader to rerun the whole suite to find them.
 * Called by `recordTimings` in `test-shard.mjs` after `collectTestRun` has answered.
 *
 * @param results - The finished top-level tests, each `{ file, name, failed }`.
 * @returns `N tests failed; timings were not recorded: <file> › <name>; …` with at most `MAX_NAMED_FAILED_TESTS` names and "and K more" for the rest; whitespace runs in a name become one space, so the sentence stays one line.
 * @example
 * describeFailedRecording([{ file: 'a.test.js', name: 'breaks', failed: true }])
 * // => '1 tests failed; timings were not recorded: a.test.js › breaks.'
 */
export function describeFailedRecording(results) {
  const failed = results.filter((result) => result.failed)
  if (failed.length === 0) return undefined
  const named = failed
    .slice(0, MAX_NAMED_FAILED_TESTS)
    .map((result) => `${result.file} › ${result.name.replace(/\s+/g, ' ')}`)
  const more = failed.length - named.length
  return `${failed.length} tests failed; timings were not recorded: ${named.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`
}
