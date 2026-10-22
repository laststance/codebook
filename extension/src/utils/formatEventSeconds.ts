import { MILLISECONDS_PER_SECOND } from '../constants'

/**
 * Writes a recorded event's time as the String catalog's `<t>`: seconds since the run started, paused time included, with two decimals.
 * Called by {@link describeNodeTestReplay} and {@link describeNodeRecordedSource} for every test replay surface that names an event's time.
 * @param elapsedMs - The event's elapsed milliseconds.
 * @returns The seconds with two decimals, without the unit.
 * @example
 * formatEventSeconds(1234) // => '1.23'
 * formatEventSeconds(0) // => '0.00'
 */
export function formatEventSeconds(elapsedMs: number): string {
  return (elapsedMs / MILLISECONDS_PER_SECOND).toFixed(2)
}
