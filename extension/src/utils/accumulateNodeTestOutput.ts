import { NODE_TEST_OUTPUT_TAIL_CHARS } from '../constants'

import { cutTextToTail } from './cutTextToTail'
import type {
  NodeTestOutputIndex,
  NodeTestOutputLine,
} from './indexNodeTestOutput'
import { nodeTestOutputLineCost } from './nodeTestOutputLineCost'

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
    ? nodeTestOutputLineCost(pending.channel, pending.codePoints, false)
    : 0
  const total = index.lineTotals[lineCount]! + pendingCost
  // The kept lines are gathered from the end backward and put in order once.
  const keptFromEnd: NodeTestOutputViewLine[] = []
  let used = 0,
    startsMidLine = false
  /** Keeps a line whole when it fits, else its end, and says whether an earlier line can still be kept; `cost` is the line's shown code points, read from the index, never counted again. */
  const keep = (
    channel: NodeTestOutputLine['channel'],
    span: { start: number; end: number },
    cost: number,
    number: number,
    lineFeed: boolean,
  ): boolean => {
    if (used + cost <= limit) {
      keptFromEnd.push({
        channel,
        text: index.body.slice(span.start, span.end),
        number,
      })
      used += cost
      return used < limit
    }
    // A cut line keeps its end and no `[stderr] ` mark, which belongs to its start.
    const characters = limit - used - (lineFeed ? 1 : 0)
    if (characters > 0) {
      const text = spanTail(index.body, span, characters)
      keptFromEnd.push({ channel, text, number, cut: true })
      // The count is taken from the kept text: a line shorter than the room left keeps all of it (F114).
      used += Array.from(text).length + (lineFeed ? 1 : 0)
      startsMidLine = true
    }
    return false
  }
  // From the end backward: the unfinished line first, then the complete lines, until the tail is full.
  let earlierFits = pending
    ? keep(pending.channel, pending, pendingCost, lineCount, false)
    : true
  for (let number = lineCount - 1; earlierFits && number >= 0; number--) {
    earlierFits = keep(
      index.lineChannels[number]!,
      { start: index.lineStarts[number]!, end: index.lineEnds[number]! },
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
 * Keeps the end of a line, reading only as much of the shared body as the end needs, so a line printed without line feeds costs its tail, not its length; called by {@link accumulateNodeTestOutput} for a line that does not fit whole.
 * @param body - The index's shown text.
 * @param span - The line's span in the body.
 * @param characters - How many code points of its end to keep.
 * @returns The line's last `characters` code points (all of it when it has fewer).
 * @example spanTail('1 2 3 4 ', { start: 0, end: 8 }, 3) // => ' 4 '
 */
function spanTail(
  body: string,
  span: { start: number; end: number },
  characters: number,
): string {
  // A code point is at most two UTF-16 units, so the last twice the units hold at least the code points asked for.
  return cutTextToTail(
    body.slice(Math.max(span.start, span.end - characters * 2), span.end),
    characters,
  )
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
