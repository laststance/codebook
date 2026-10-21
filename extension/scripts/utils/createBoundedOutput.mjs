import {
  EMPTY_SUMMARY_STATE,
  foldSummaryLine,
  readRunSummary,
  summaryCounts,
} from './readRunSummary.mjs'
import { TEST_OUTPUT_KEEP_CHARS } from './testShardConstants.mjs'

/** The streams of a call that a chunk can come from. */
const STREAMS = ['stdout', 'stderr']

/** A line this long cannot be a summary line (they hold at most about 50 characters), so the keeper stops holding the beginning of a line at this length. */
const LONGEST_SUMMARY_LINE_CHARS = 100

/** The line before the summary that the keeper repeats after the kept end, when the end holds no summary or another one. */
const REPEATED_SUMMARY_NOTE =
  '[… the runner’s own summary, repeated from the output left out:]'

/** Tells whether two summary counts are the same numbers under the same names. @example sameCounts({ tests: 1 }, { tests: 1 }) // => true */
function sameCounts(left, right) {
  return (
    JSON.stringify(Object.entries(left ?? {}).toSorted()) ===
    JSON.stringify(Object.entries(right ?? {}).toSorted())
  )
}

/**
 * Keeps the end of the output of a `node --test` call within a bound, so a test that prints without end cannot grow the memory of the runner that reads it, and keeps the call's summary counts whatever the bound cuts.
 *
 * Why: a runner needs two things from a call's output, the summary lines and the report of the failing tests. Node 24 prints the summary block first and the failing tests' report after it (`ℹ tests 2` … `ℹ duration_ms …`, then `✖ failing tests:`), so a report longer than the bound pushes the summary out of the kept end. The keeper therefore reads every line as it arrives ({@link foldSummaryLine}) and holds the last summary block of the whole output; when the kept end does not read as that block ({@link readRunSummary}), the block is repeated after the kept end under a note. The kept end starts at a line start, so a half of a summary line is never read as a summary, and a note says how much was left out.
 * Called by {@link runTestInvocation} (the shard script's calls) and by `scripts/run-pregate-tests.mjs` (the pre-gate's runs).
 * @param keepChars - How many characters of the end to keep ({@link TEST_OUTPUT_KEEP_CHARS} by default). The keeper holds at most twice that many, so it cuts once for each `keepChars` of new output and not for each chunk.
 * @returns `{ append, text }`: `append(chunk, stream)` adds a chunk of text that came from `stream` (`'stdout'` or `'stderr'`; anything else throws a `TypeError`) and keeps it in the order the chunks came. The summary reading follows stdout alone, which holds the one unfinished line: a chunk of stderr between two chunks of a summary line of stdout neither splices that line nor, as a complete line, breaks the block, and a line of stderr in the form of a summary line counts nothing. The kept text can still read spliced (stderr text inside a summary line), and the repeated block below then answers the counts; `text()` answers the kept end, with a first line `[… N characters of earlier output left out; at most the last M are kept]` when anything was left out, and the whole output otherwise. When the kept end does not read as the output's last summary block, the answer ends with the repeated block (a note line and the block's lines), and an output with no summary block gets none.
 * @example
 * const output = createBoundedOutput(50)
 * output.append('first\n', 'stdout')
 * output.text() // => 'first\n'
 */
export function createBoundedOutput(keepChars = TEST_OUTPUT_KEEP_CHARS) {
  let kept = ''
  let leftOutChars = 0
  // The summary reading of every complete line so far, and the line that has not ended yet.
  let summaryState = EMPTY_SUMMARY_STATE
  let unfinishedLine = ''
  // The rest of a line longer than any summary line is skipped up to its line break.
  let skippingLongLine = false

  /** Reads a chunk line by line into the summary state; the unfinished line is held only while it can still be a summary line. */
  const readSummaryLines = (chunk) => {
    let rest = chunk
    if (skippingLongLine) {
      const lineBreak = rest.indexOf('\n')
      if (lineBreak === -1) return
      skippingLongLine = false
      rest = rest.slice(lineBreak + 1)
    }
    const lines = (unfinishedLine + rest).split('\n')
    unfinishedLine = lines.pop()
    for (const line of lines) summaryState = foldSummaryLine(summaryState, line)
    if (unfinishedLine.length > LONGEST_SUMMARY_LINE_CHARS) {
      // The line is no summary line, whatever follows it; it still closes an open block.
      summaryState = foldSummaryLine(summaryState, unfinishedLine)
      unfinishedLine = ''
      skippingLongLine = true
    }
  }

  /** Cuts the kept text down to its last `keepChars` characters, from a line start when one is near, and counts what was cut. */
  const cutToBound = () => {
    if (kept.length <= keepChars) return
    let cut = kept.length - keepChars
    // The kept end starts after a line break, so no line is kept in part; a single line longer than the bound is cut where it is.
    // A kept end that holds a line break therefore starts at a line start of the whole output, and no fake summary line is left at its front.
    if (kept[cut - 1] !== '\n') {
      const lineBreak = kept.indexOf('\n', cut)
      if (lineBreak !== -1) cut = lineBreak + 1
    }
    leftOutChars += cut
    kept = kept.slice(cut)
  }

  /** Answers the text that follows the kept end so that its last summary block is the whole output's, or an empty string when the kept end already reads so. */
  const repeatedSummary = (keptText) => {
    // The line that has not ended yet counts as a last line, as {@link readRunSummary} counts it.
    const finalState = foldSummaryLine(summaryState, unfinishedLine)
    const wanted = summaryCounts(finalState)
    if (wanted === undefined || sameCounts(readRunSummary(keptText), wanted))
      return ''
    const lines = [...finalState.last.values()].map(({ text }) => text)
    return `${keptText.endsWith('\n') ? '' : '\n'}${REPEATED_SUMMARY_NOTE}\n${lines.join('\n')}\n`
  }

  return {
    append(chunk, stream) {
      if (!STREAMS.includes(stream))
        throw new TypeError(
          `createBoundedOutput: the stream of a chunk is 'stdout' or 'stderr', not ${String(stream)}.`,
        )
      // The runner prints its summary on stdout. A chunk of stderr is a line of its own: read into the one unfinished line, it would splice a summary line of stdout that is split across two chunks (and a complete line of stderr between two lines of the block would break it), so it is kept in the text and not read.
      if (stream === 'stdout') readSummaryLines(chunk)
      kept += chunk
      if (kept.length > 2 * keepChars) cutToBound()
    },
    text() {
      cutToBound()
      const keptText =
        leftOutChars === 0
          ? kept
          : `[… ${leftOutChars} characters of earlier output left out; at most the last ${keepChars} are kept]\n${kept}`
      return keptText + repeatedSummary(keptText)
    },
  }
}
