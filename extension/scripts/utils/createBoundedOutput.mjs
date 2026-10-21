import { TEST_OUTPUT_KEEP_CHARS } from './testShardConstants.mjs'

/**
 * Keeps the end of the output of a `node --test` call within a bound, so a test that prints without end cannot grow the memory of the runner that reads it.
 *
 * Why: a runner needs two things from a call's output, the summary lines and the report of the failing tests, and Node prints both last. The rest has been shown or is not needed. The kept end starts at a line start, so a half of a summary line is never read as a summary, and a note says how much was left out.
 * Called by {@link runTestInvocation} (the shard script's calls) and by `scripts/run-pregate-tests.mjs` (the pre-gate's runs).
 * @param keepChars - How many characters of the end to keep ({@link TEST_OUTPUT_KEEP_CHARS} by default). The keeper holds at most twice that many, so it cuts once for each `keepChars` of new output and not for each chunk.
 * @returns `{ append, text }`: `append(chunk)` adds a chunk of text; `text()` answers the kept end, with a first line `[… N characters of earlier output left out; the last M are kept]` when anything was left out, and the whole output otherwise.
 * @example
 * const output = createBoundedOutput(50)
 * output.append('first\n')
 * output.text() // => 'first\n'
 */
export function createBoundedOutput(keepChars = TEST_OUTPUT_KEEP_CHARS) {
  let kept = ''
  let leftOutChars = 0

  /** Cuts the kept text down to its last `keepChars` characters, from a line start when one is near, and counts what was cut. */
  const cutToBound = () => {
    if (kept.length <= keepChars) return
    let cut = kept.length - keepChars
    // The kept end starts after a line break, so no line is kept in part; a single line longer than the bound is cut where it is.
    if (kept[cut - 1] !== '\n') {
      const lineBreak = kept.indexOf('\n', cut)
      if (lineBreak !== -1) cut = lineBreak + 1
    }
    leftOutChars += cut
    kept = kept.slice(cut)
  }

  return {
    append(chunk) {
      kept += chunk
      if (kept.length > 2 * keepChars) cutToBound()
    },
    text() {
      cutToBound()
      return leftOutChars === 0
        ? kept
        : `[… ${leftOutChars} characters of earlier output left out; at most the last ${keepChars} are kept]\n${kept}`
    },
  }
}
