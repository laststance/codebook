import { SPLIT_TEST_FILE_MS } from './testShardConstants.mjs'

/**
 * Tells whether a recorded test file is slow enough, and has enough named tests with a recorded time, to run in parts; called by {@link planTestShards} to plan a file and by `scripts/test-shard.mjs --whole-split-files` to find the files whose parts hide errors after the last test.
 * @param timing - The file's entry of the timings file, `{ totalMs, tests? }`, or `undefined` for a file the timings do not know.
 * @returns `true` when the plan splits the file: a total above the split limit, more than one named test, and at least one test that took more than 0 ms.
 * @example
 * isSplitTestFile({ totalMs: 9000, tests: { a: 5000, b: 4000 } }) // => true
 */
export function isSplitTestFile(timing) {
  if (timing === undefined || !(timing.totalMs > SPLIT_TEST_FILE_MS))
    return false
  const durations = Object.values(timing.tests ?? {})
  // Tests that all took 0 ms leave nothing to balance by time: such a file is one unit, planned at its recorded total.
  return durations.length > 1 && durations.some((ms) => ms > 0)
}
