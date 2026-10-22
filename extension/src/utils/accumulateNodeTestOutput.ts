import { NODE_TEST_OUTPUT_TAIL_CHARS } from '../constants'

import { cutTextToTail } from './cutTextToTail'
import { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'
import type {
  NodeTestOutputIndex,
  NodeTestOutputLine,
  NodeTestOutputPendingLine,
} from './indexNodeTestOutput'

/** A kept line of the Application pane: its absolute number in the replay's output (an unfinished last line takes the next number), and `cut` when only its end fits. */
export type NodeTestOutputViewLine = NodeTestOutputLine & {
  number: number
  cut?: true
}

/** The recorded output the Application pane shows at one event: its kept end, what was left out before it and the Node inspector lines folded away. */
export type NodeTestOutputTail = {
  lines: NodeTestOutputViewLine[]
  omittedCharacters: number
  startsMidLine: boolean
  inspectorLines: number
  hasOutput: boolean
}

/**
 * Collects the recorded output up to a selected event, keeping its end, so the Application pane shows what the test had printed by that moment and nothing after it; called by the Study workspace for each selected event of a test replay.
 * It walks backward from the last output at or before the event until the tail is full (S1-2), so a selection costs a lookup plus the tail, however long the output is.
 * @param index - The replay's output read once ({@link indexNodeTestOutput}).
 * @param sequence - The selected event's sequence.
 * @param limit - How many code points of shown text to keep ({@link NODE_TEST_OUTPUT_TAIL_CHARS}).
 * @returns The kept lines in order; `omittedCharacters`, the code points of shown text before them; `startsMidLine` when the first kept line keeps only its end; the Node inspector lines so far; `hasOutput: false` when no line to show was printed by that event.
 * @example
 * accumulateNodeTestOutput(indexNodeTestOutput(history.entries), 3).lines.map((line) => line.text) // => ['RUN app.test.ts', 'ok']
 */
export function accumulateNodeTestOutput(
  index: NodeTestOutputIndex,
  sequence: number,
  limit = NODE_TEST_OUTPUT_TAIL_CHARS,
): NodeTestOutputTail {
  const position = lastAtOrBefore(index.sequences, sequence)
  if (position < 0)
    return {
      lines: [],
      omittedCharacters: 0,
      startsMidLine: false,
      inspectorLines: 0,
      hasOutput: false,
    }
  const { lineCount, pending, inspectorLines } = index.after[position]!
  const pendingCost = pending
    ? markCost(pending.channel) + pending.codePoints
    : 0
  const total = index.lineTotals[lineCount]! + pendingCost
  // The kept lines are gathered from the end backward and put in order once.
  const keptFromEnd: NodeTestOutputViewLine[] = []
  let used = 0,
    startsMidLine = false
  /** Keeps a line whole when it fits, else its end, and says whether an earlier line can still be kept; `cost` is the line's shown code points, read from the index, never counted again. */
  const keep = (
    line: () => NodeTestOutputLine,
    tail: (characters: number) => string,
    cost: number,
    number: number,
    lineFeed: boolean,
  ): boolean => {
    if (used + cost <= limit) {
      keptFromEnd.push({ ...line(), number })
      used += cost
      return used < limit
    }
    // A cut line keeps its end and no `[stderr] ` mark, which belongs to its start.
    const characters = limit - used - (lineFeed ? 1 : 0)
    if (characters > 0) {
      keptFromEnd.push({
        channel: line().channel,
        text: tail(characters),
        number,
        cut: true,
      })
      used += characters + (lineFeed ? 1 : 0)
      startsMidLine = true
    }
    return false
  }
  // From the end backward: the unfinished line first, then the complete lines, until the tail is full.
  let earlierFits = pending
    ? keep(
        () => ({ channel: pending.channel, text: pendingText(pending) }),
        (characters) => pendingTail(pending, characters),
        pendingCost,
        lineCount,
        false,
      )
    : true
  for (let number = lineCount - 1; earlierFits && number >= 0; number--) {
    const line = index.lines[number]!
    earlierFits = keep(
      () => line,
      (characters) => cutTextToTail(line.text, characters),
      index.lineTotals[number + 1]! - index.lineTotals[number]!,
      number,
      true,
    )
  }
  return {
    lines: keptFromEnd.reverse(),
    omittedCharacters: total - used,
    startsMidLine,
    inspectorLines,
    // Output of only Node inspector lines or terminal controls shows no line, so the pane says that nothing was printed.
    hasOutput: lineCount > 0 || pending !== undefined,
  }
}

/**
 * The code points the `[stderr] ` mark adds to a line of a channel; called by {@link accumulateNodeTestOutput} for the unfinished line, whose own code points the index counted.
 * @param channel - The line's channel.
 * @returns The mark's length for standard error, else 0.
 * @example markCost('stderr') // => 9
 */
function markCost(channel: NodeTestOutputLine['channel']): number {
  return channel === 'stderr' ? NODE_TEST_REPLAY_TEXT.stderrMark.length : 0
}

/**
 * Joins the unfinished line as an entry left it; called by {@link accumulateNodeTestOutput} only when the whole line fits the tail.
 * @param pending - The unfinished line at the selected entry.
 * @returns Its text.
 * @example pendingText({ channel: 'stdout', chunks: ['1 ', '2 ', '3'], chunkCount: 2, codePoints: 4 }) // => '1 2 '
 */
function pendingText(pending: NodeTestOutputPendingLine): string {
  return pending.chunks.slice(0, pending.chunkCount).join('')
}

/**
 * Keeps the end of the unfinished line as an entry left it, reading its chunks from the last one backward only until they hold enough, so a line printed without line feeds costs its tail, not its length; called by {@link accumulateNodeTestOutput} when the line does not fit whole.
 * @param pending - The unfinished line at the selected entry.
 * @param characters - How many code points of its end to keep.
 * @returns Its last `characters` code points.
 * @example pendingTail({ channel: 'stdout', chunks: ['1 2 ', '3 4 '], chunkCount: 2, codePoints: 8 }, 3) // => ' 4 '
 */
function pendingTail(
  pending: NodeTestOutputPendingLine,
  characters: number,
): string {
  const parts: string[] = []
  let held = 0
  // A code point is at most two UTF-16 units, so chunks holding twice the units hold at least the code points asked for.
  for (
    let chunk = pending.chunkCount - 1;
    chunk >= 0 && held < characters * 2;
    chunk--
  ) {
    const text = pending.chunks[chunk]!
    parts.push(text)
    held += text.length
  }
  return cutTextToTail(parts.reverse().join(''), characters)
}

/**
 * Finds the last position whose value is at most a bound in an ascending list; called by {@link accumulateNodeTestOutput} for the last output at or before the selected event.
 * @param values - Ascending numbers.
 * @param bound - The bound.
 * @returns The last position with a value at most `bound`, or -1 when there is none.
 * @example lastAtOrBefore([2, 5, 9], 6) // => 1
 */
function lastAtOrBefore(values: readonly number[], bound: number): number {
  let low = 0,
    high = values.length - 1,
    found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (values[middle]! <= bound) {
      found = middle
      low = middle + 1
    } else high = middle - 1
  }
  return found
}
