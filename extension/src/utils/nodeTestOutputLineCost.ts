import { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'
import type { NodeTestOutputLine } from './indexNodeTestOutput'

/**
 * How many code points a line takes as the Application pane shows it; called by {@link indexNodeTestOutput} and {@link accumulateNodeTestOutput}.
 * @param line - The line.
 * @param lineFeed - Whether a line feed ends it (every line but an unfinished last one).
 * @returns Its text's code points, plus the `[stderr] ` mark for a standard-error line and one for the line feed.
 * @example nodeTestOutputLineCost({ channel: 'stderr', text: 'warn' }, true) // => 14
 */
export function nodeTestOutputLineCost(
  line: NodeTestOutputLine,
  lineFeed: boolean,
): number {
  return (
    Array.from(line.text).length +
    (line.channel === 'stderr' ? NODE_TEST_REPLAY_TEXT.stderrMark.length : 0) +
    (lineFeed ? 1 : 0)
  )
}
