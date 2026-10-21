/** The test runner's summary lines (`ℹ tests 12`, `ℹ pass 12`, …) as one line of output matches them: the name and the number. A number has at most 15 digits (and 20 after the point), so a summary line is short and a reader that holds a line cannot be made to hold a long one. */
export const SUMMARY_LINE =
  /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d{1,15}(?:\.\d{1,20})?)$/

/** The counts a summary must hold to count as the runner's own: a lone `ℹ tests 99` line is not one. */
const REQUIRED_COUNTS = ['tests', 'pass', 'fail']

/** The state before any line is read: no block is open and no complete block has been seen. */
export const EMPTY_SUMMARY_STATE = Object.freeze({
  block: undefined,
  last: undefined,
})

/**
 * Reads one more line of an output into the state of the summary reader, without changing the state it is given.
 *
 * Why: the last summary block of an output can be found in one pass over its lines, so a reader that never holds the whole output ({@link createBoundedOutput}) can keep the answer for what it cut away. {@link readRunSummary} is this function folded over all the lines.
 * Called by {@link readRunSummary} and by {@link createBoundedOutput}.
 * @param state - `{ block, last }`: `block` is the open block (a Map from a count's name to `{ text, count }`) or `undefined` when the last line was no summary line; `last` is the last block that held `tests`, `pass` and `fail`, as it stood after its latest line.
 * @param line - One line of output, without its line break.
 * @returns The state after the line. A line that is no summary line closes the open block; a `tests` line opens a new one; the other summary lines join the open block, and are dropped when none is open.
 * @example
 * foldSummaryLine(EMPTY_SUMMARY_STATE, 'ℹ tests 1').block.get('tests') // => { text: 'ℹ tests 1', count: 1 }
 */
export function foldSummaryLine(state, line) {
  const match = SUMMARY_LINE.exec(line)
  if (!match)
    return state.block === undefined ? state : { ...state, block: undefined }
  const [, name, digits] = match
  // A `tests` line starts a new block; the lines that follow it without a break belong to it.
  if (name !== 'tests' && state.block === undefined) return state
  // A copy, so a block that is the answer is never changed by the lines that follow it, and a later block never touches it.
  const block = new Map(name === 'tests' ? [] : state.block)
  block.set(name, { text: line, count: Number(digits) })
  const isComplete = REQUIRED_COUNTS.every((required) => block.has(required))
  return { block, last: isComplete ? block : state.last }
}

/**
 * Turns the last complete block of a summary state into the counts by name.
 *
 * Called by {@link readRunSummary}.
 * @param state - A state from {@link foldSummaryLine}.
 * @returns `{ tests: 12, pass: 12, fail: 0, … }`, or `undefined` when no complete block was seen.
 * @example
 * summaryCounts(EMPTY_SUMMARY_STATE) // => undefined
 */
export function summaryCounts(state) {
  if (state.last === undefined) return undefined
  return Object.fromEntries(
    [...state.last].map(([name, { count }]) => [name, count]),
  )
}

/**
 * Reads the counts of the last summary block in the output of one `node --test` call.
 *
 * Why: the runner prints its summary as one block of lines at column 0, and the failing tests' report (indented, apart from its headings) follows it. A test may print a line of that form too, in the middle of the output; the first such line, or the sum of all of them, would count the test's text and not the run. The last block is the runner's own, and a block without `tests`, `pass` and `fail` is no summary: a runner that died before its summary leaves none.
 * Called by `scripts/test-shard.mjs` (the count of a call) and by {@link combinedSummary} (the counts of a pre-gate run).
 * @param output - The whole output of one call, or its kept tail ({@link createBoundedOutput}).
 * @returns The counts of the last complete block by name (`{ tests: 12, pass: 12, fail: 0, … }`), or `undefined` when the output holds none.
 * @example
 * readRunSummary('ℹ tests 99\n✔ a\nℹ tests 1\nℹ pass 1\nℹ fail 0') // => { tests: 1, pass: 1, fail: 0 }
 * readRunSummary('ℹ tests 99') // => undefined
 */
export function readRunSummary(output) {
  let state = EMPTY_SUMMARY_STATE
  for (const line of output.split('\n')) state = foldSummaryLine(state, line)
  return summaryCounts(state)
}
