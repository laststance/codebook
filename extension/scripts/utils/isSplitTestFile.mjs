import { SPLIT_TEST_FILE_MS } from './testShardConstants.mjs'

/**
 * Tells whether a recorded test file is slow enough, and has enough named tests, to run in parts; called by {@link planTestShards} to plan a file and by `scripts/test-shard.mjs --whole-split-files` to find the files whose parts hide errors after the last test.
 * @param timing - The file's entry of the timings file, `{ totalMs, tests? }`, or `undefined` for a file the timings do not know.
 * @returns `true` when the plan splits the file.
 * @example
 * isSplitTestFile({ totalMs: 9000, tests: { a: 5000, b: 4000 } }) // => true
 */
export function isSplitTestFile(timing) {
  return (
    timing !== undefined &&
    timing.totalMs > SPLIT_TEST_FILE_MS &&
    Object.keys(timing.tests ?? {}).length > 1
  )
}
