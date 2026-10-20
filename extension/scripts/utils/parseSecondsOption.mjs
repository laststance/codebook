import {
  MAX_TIMER_DELAY_MS,
  MIN_TIMER_DELAY_MS,
} from './testShardConstants.mjs'

/**
 * Reads the text of an option that gives a time limit in seconds and refuses a value that would end every wait at once or never: no number, 0 or less (a timer of NaN or 0 ms fires first), less than one millisecond (a timer keeps no shorter wait), `Infinity`, or more than `setTimeout` can wait (Node then fires at once with a TimeoutOverflowWarning).
 *
 * Called by {@link parseSilenceSeconds} and by `scripts/run-pregate-tests.mjs` for `--build-seconds`.
 * @param optionName - The option as the command line spells it, for the refusal's first words.
 * @param text - The option's text, as the command line gave it.
 * @returns The limit in seconds.
 * @throws With a one-line message when the text is no number above 0, is under 0.001, or its milliseconds pass {@link MAX_TIMER_DELAY_MS}.
 * @example
 * parseSecondsOption('--build-seconds', '120') // => 120
 * parseSecondsOption('--build-seconds', '0.0004') // throws '--build-seconds must be at least 0.001, the shortest wait a timer keeps.'
 */
export function parseSecondsOption(optionName, text) {
  const seconds = Number(text)
  if (!(seconds > 0)) throw new Error(`${optionName} must be a number above 0.`)
  if (seconds * 1000 < MIN_TIMER_DELAY_MS)
    throw new Error(
      `${optionName} must be at least ${MIN_TIMER_DELAY_MS / 1000}, the shortest wait a timer keeps.`,
    )
  // `Infinity * 1000` is `Infinity`, so one comparison refuses it too.
  if (seconds * 1000 > MAX_TIMER_DELAY_MS)
    throw new Error(
      `${optionName} must be at most ${Math.floor(MAX_TIMER_DELAY_MS / 1000)}, the longest wait a timer allows.`,
    )
  return seconds
}
