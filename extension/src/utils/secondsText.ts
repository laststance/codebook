import { MILLISECONDS_PER_SECOND } from '../constants'

/**
 * Words a bound given in milliseconds as seconds for a help sentence, so the help follows the constant and stays grammatical when it changes.
 * Called by {@link readResource} for the pause bounds the repository-browser help names.
 * @param milliseconds - The bound, a whole number of seconds.
 * @returns
 * - For exactly one second: `'1 second'`
 * - Otherwise: the count and `'seconds'`
 * @example
 * secondsText(1_000) // => '1 second'
 * secondsText(3_000) // => '3 seconds'
 */
export function secondsText(milliseconds: number): string {
  const seconds = milliseconds / MILLISECONDS_PER_SECOND
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
}
