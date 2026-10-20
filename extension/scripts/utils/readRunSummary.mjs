/** The test runner's summary lines (`ℹ tests 12`, `ℹ pass 12`, …) as one line of output matches them: the name and the number. */
export const SUMMARY_LINE =
  /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d+(?:\.\d+)?)$/

/** The counts a summary must hold to count as the runner's own: a lone `ℹ tests 99` line is not one. */
const REQUIRED_COUNTS = ['tests', 'pass', 'fail']

/**
 * Reads the counts of the last summary block in the output of one `node --test` call.
 *
 * Why: the runner prints its summary last, as one block of lines at column 0. A test may print a line of that form too, in the middle of the output; the first such line, or the sum of all of them, would count the test's text and not the run. The last block is the runner's own, and a block without `tests`, `pass` and `fail` is no summary: a runner that died before its summary leaves none.
 * Called by `scripts/test-shard.mjs` (the count of a call) and by {@link combinedSummary} (the counts of a pre-gate run).
 * @param output - The whole output of one call, or its kept tail.
 * @returns The counts of the last complete block by name (`{ tests: 12, pass: 12, fail: 0, … }`), or `undefined` when the output holds none.
 * @example
 * readRunSummary('ℹ tests 99\n✔ a\nℹ tests 1\nℹ pass 1\nℹ fail 0') // => { tests: 1, pass: 1, fail: 0 }
 * readRunSummary('ℹ tests 99') // => undefined
 */
export function readRunSummary(output) {
  let last
  let block
  for (const line of output.split('\n')) {
    const match = SUMMARY_LINE.exec(line)
    if (!match) {
      block = undefined
      continue
    }
    // A `tests` line starts a new block; the lines that follow it without a break belong to it.
    if (match[1] === 'tests') block = {}
    if (!block) continue
    block[match[1]] = Number(match[2])
    // A copy, so the lines that follow in the same block add to the answer but a later block never changes it.
    if (REQUIRED_COUNTS.every((name) => name in block)) last = { ...block }
  }
  return last
}
