import { isSplitTestFile } from './isSplitTestFile.mjs'
import { planTestShards } from './planTestShards.mjs'

/**
 * Plans the files that {@link planTestShards} splits into name-selected parts as whole-file calls without any name pattern, so Node's default exit applies and an error raised after a file's last test is reported; called by `scripts/test-shard.mjs --whole-split-files`.
 * @param input.files - Base names of the compiled test files.
 * @param input.timings - Parsed timings file.
 * @param input.lanes - Number of sequences that run at the same time.
 * @returns One list of invocations per lane (`{ files, ms }`), covering only the split files.
 * @example
 * planWholeSplitFiles({ files: ['a.test.js'], timings: { files: {} }, lanes: 2 }) // => [[], []]
 */
export function planWholeSplitFiles({ files, timings, lanes }) {
  const splitFiles = files.filter((file) =>
    isSplitTestFile(timings.files[file]),
  )
  const wholeFileTimings = {
    files: Object.fromEntries(
      splitFiles.map((file) => [
        file,
        { totalMs: timings.files[file].totalMs },
      ]),
    ),
  }
  return planTestShards({
    files: splitFiles,
    timings: wholeFileTimings,
    shards: 1,
    lanes,
  })[0]
}
