import { runSummaryLine } from './planPregateRuns.mjs'
import { TEST_LINE_FLUSH_CHARS } from './testShardConstants.mjs'

/**
 * Passes the output of one run to a writer line by line, with each summary line marked as the run's own ({@link runSummaryLine}), and holds no more than `maxLineChars` of a line that has not ended.
 *
 * Why: the runner reads the output in chunks that end anywhere; a summary line is known only when its line has ended. A test that prints without a line break would make the held part grow without end, so a line that passes the limit is written in pieces, as it is: a piece is never marked, because it is not a whole line.
 * Called by `scripts/run-pregate-tests.mjs` for each chunk of each run's standard output.
 * @param write - Receives the text to write, with line breaks.
 * @param maxLineChars - The longest part of an unfinished line to hold ({@link TEST_LINE_FLUSH_CHARS} by default).
 * @returns `{ push, end }`: `push(chunk)` takes the next chunk; `end()` writes the last line, which may come without its line break, and ends it with one.
 * @example
 * const forwarder = createRunLineForwarder((text) => process.stdout.write(text))
 * forwarder.push('ℹ tests 1\n') // writes 'ℹ run tests 1\n'
 */
export function createRunLineForwarder(
  write,
  maxLineChars = TEST_LINE_FLUSH_CHARS,
) {
  let pending = ''
  // True while the line being read was begun in a piece that was already written; the rest of it is written as it is.
  let continuesWrittenPiece = false
  const finishedLine = (line) =>
    (continuesWrittenPiece ? line : runSummaryLine(line)) + '\n'

  return {
    push(chunk) {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        write(finishedLine(line))
        continuesWrittenPiece = false
      }
      if (pending.length > maxLineChars) {
        write(pending)
        pending = ''
        continuesWrittenPiece = true
      }
    },
    end() {
      // The last line may come without its line end.
      if (pending) write(finishedLine(pending))
    },
  }
}
