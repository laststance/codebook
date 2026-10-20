import { MAX_TIMER_DELAY_MS } from './testShardConstants.mjs'

/**
 * Reads the text of `--silence-seconds` and refuses a value that would end every call at once: no number, 0 or less (a timer of NaN or 0 ms fires first), `Infinity`, or more than `setTimeout` can wait (Node then fires at once with a TimeoutOverflowWarning).
 *
 * Called by `scripts/test-shard.mjs` and `scripts/run-pregate-tests.mjs` when they read their command line.
 * @param text - The option's text, as the command line gave it.
 * @returns The limit in seconds.
 * @throws With a one-line message when the text is no number above 0 or its milliseconds pass {@link MAX_TIMER_DELAY_MS}.
 * @example
 * parseSilenceSeconds('120') // => 120
 * parseSilenceSeconds('Infinity') // throws '--silence-seconds must be at most 2147483, the longest wait a timer allows.'
 */
export function parseSilenceSeconds(text) {
  const seconds = Number(text)
  if (!(seconds > 0))
    throw new Error('--silence-seconds must be a number above 0.')
  // `Infinity * 1000` is `Infinity`, so one comparison refuses it too.
  if (seconds * 1000 > MAX_TIMER_DELAY_MS)
    throw new Error(
      `--silence-seconds must be at most ${Math.floor(MAX_TIMER_DELAY_MS / 1000)}, the longest wait a timer allows.`,
    )
  return seconds
}
