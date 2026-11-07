import { basename } from 'node:path'

/** Seconds a test file counts when the timings file does not know it, so a new file still lands on the lightest shard. */
const UNKNOWN_FILE_SECONDS = 1

/** Reads the recorded whole-file seconds of one compiled test file, or {@link UNKNOWN_FILE_SECONDS}. @example secondsOf('dist/tests/a.test.js', { files: { 'a.test.js': { totalMs: 2500 } } }) // => 2.5 */
function secondsOf(file, timings) {
  const entry = timings.files[basename(file)]
  return entry ? entry.totalMs / 1000 : UNKNOWN_FILE_SECONDS
}

/**
 * Divides the compiled test files over the shards of the sharded measured health run so that every shard takes about the same time; called by `scripts/checkHealth.mjs` in `--shard` mode only, which runs its own share. The `--merge` mode does not plan: it checks the shards' file lists against the files of its own build ({@link checkHealthShards}).
 *
 * A file is never split: coverage dumps are collected one process per file, and the merge proves every file ran once. Files go heaviest first onto the lightest shard; equal weights keep path order, so every job computes the same plan from the same inputs.
 * @param files - Compiled test files, for example `dist/tests/service.test.js`.
 * @param timings - Parsed timings file of {@link readTestTimings}: `{ files: { [baseName]: { totalMs } } }`.
 * @param total - Number of shards (1 or more).
 * @returns One path-sorted list of files per shard, in shard order (index 0 is shard 1).
 * @example
 * planHealthShards(['dist/tests/a.test.js', 'dist/tests/b.test.js', 'dist/tests/c.test.js'], { files: { 'a.test.js': { totalMs: 5000 } } }, 2)
 * // => [['dist/tests/a.test.js'], ['dist/tests/b.test.js', 'dist/tests/c.test.js']]
 */
export function planHealthShards(files, timings, total) {
  const shards = Array.from({ length: total }, () => ({
    seconds: 0,
    files: [],
  }))
  // Code-unit order, not locale order, so a runner's locale never changes the plan.
  const weighted = files
    .toSorted()
    .map((file) => ({ file, seconds: secondsOf(file, timings) }))
    // The sort is stable: equal weights stay in path order.
    .toSorted((left, right) => right.seconds - left.seconds)
  for (const { file, seconds } of weighted) {
    // Strict "<" keeps the earlier shard on a tie.
    const lightest = shards.reduce((best, shard) =>
      shard.seconds < best.seconds ? shard : best,
    )
    lightest.files.push(file)
    lightest.seconds += seconds
  }
  return shards.map((shard) => shard.files.toSorted())
}
