import { SPLIT_TEST_FILE_MS } from './testShardConstants.mjs'

/** Adds up the durations of a recording by file and test name; tests generated in a loop can share a name, and a name pattern selects all of them together. @example sumDurations([{ file: 'a.test.js', name: 'opens', ms: 12 }]) // => Map { 'a.test.js' => Map { 'opens' => 12 } } */
function sumDurations(results) {
  const durations = new Map()
  for (const { file, name, ms } of results) {
    const tests = durations.get(file) ?? new Map()
    tests.set(name, (tests.get(name) ?? 0) + ms)
    durations.set(file, tests)
  }
  return durations
}

/** Describes one file for the timings file: its total, and its tests by name only when the file is slow enough to be split. @example timingOfFile(new Map([['opens', 12.4]])) // => { totalMs: 12 } */
function timingOfFile(tests) {
  const totalMs = [...tests.values()].reduce((sum, ms) => sum + ms, 0)
  if (totalMs <= SPLIT_TEST_FILE_MS) return { totalMs: Math.round(totalMs) }
  return {
    totalMs: Math.round(totalMs),
    tests: Object.fromEntries(
      [...tests.keys()]
        .toSorted()
        .map((name) => [name, Math.round(tests.get(name))]),
    ),
  }
}

/**
 * Condenses the finished tests of a recording run into the timings file that {@link planTestShards} reads; called by `scripts/test-shard.mjs --record`.
 *
 * Only files slow enough to be split keep their per-test durations, so the file stays reviewable.
 * @param results - One `{ file, name, ms }` per finished top-level test; `file` is a base name.
 * @returns `{ files: { [file]: { totalMs, tests? } } }` with keys sorted and durations rounded to whole milliseconds.
 * @example
 * buildTestTimings([{ file: 'a.test.js', name: 'opens', ms: 12.4 }])
 * // => { files: { 'a.test.js': { totalMs: 12 } } }
 */
export function buildTestTimings(results) {
  const durations = sumDurations(results)
  return {
    files: Object.fromEntries(
      [...durations.keys()]
        .toSorted()
        .map((file) => [file, timingOfFile(durations.get(file))]),
    ),
  }
}
