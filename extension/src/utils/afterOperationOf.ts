/**
 * Reads the operation a declared stop follows, for the runtime and the history validators that handle stops of every configuration version.
 * Only a version 3 stop declares `afterOperation` (1-based); the stops of versions 1 and 2 belong to the run's one action and have none.
 * @param stop - A stop as {@link configuredStops} gives it.
 * @returns The stop's `afterOperation`, or `undefined` for a stop of version 1 or 2.
 * @example
 * afterOperationOf({ afterOperation: 2 }) // => 2
 * afterOperationOf({ participant: 'browser' }) // => undefined
 */
export function afterOperationOf(stop: object): number | undefined {
  return 'afterOperation' in stop && typeof stop.afterOperation === 'number'
    ? stop.afterOperation
    : undefined
}
