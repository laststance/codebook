import { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'
import type { NodeTestOutputLine } from './indexNodeTestOutput'

/**
 * How many code points a line takes as the Application pane shows it; called by {@link indexNodeTestOutput} for each line it completes and by {@link accumulateNodeTestOutput} for the unfinished one.
 * @param channel - The channel that wrote the line.
 * @param codePoints - The code points of the line's text.
 * @param lineFeed - Whether a line feed ends it (every line but an unfinished last one).
 * @returns The text's code points, plus the `[stderr] ` mark for a standard-error line and one for the line feed.
 * @example nodeTestOutputLineCost('stderr', 4, true) // => 14
 */
export function nodeTestOutputLineCost(
  channel: NodeTestOutputLine['channel'],
  codePoints: number,
  lineFeed: boolean,
): number {
  return (
    codePoints +
    (channel === 'stderr' ? NODE_TEST_REPLAY_TEXT.stderrMark.length : 0) +
    (lineFeed ? 1 : 0)
  )
}
