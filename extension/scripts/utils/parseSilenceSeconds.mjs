import { parseSecondsOption } from './parseSecondsOption.mjs'

/**
 * Reads the text of `--silence-seconds` and refuses a value that would end every call at once: see {@link parseSecondsOption} for the refused values (no number, 0 or less, under 1 ms, `Infinity`, over what `setTimeout` can wait).
 *
 * Called by `scripts/test-shard.mjs` and `scripts/run-pregate-tests.mjs` when they read their command line.
 * @param text - The option's text, as the command line gave it.
 * @returns The limit in seconds.
 * @throws With a one-line message that starts with `--silence-seconds`.
 * @example
 * parseSilenceSeconds('120') // => 120
 * parseSilenceSeconds('Infinity') // throws '--silence-seconds must be at most 2147483, the longest wait a timer allows.'
 */
export function parseSilenceSeconds(text) {
  return parseSecondsOption('--silence-seconds', text)
}
