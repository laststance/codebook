/** A zero-based place in an executed module, as the debugger protocol names a location's line and column. */
export interface GeneratedPlace {
  lineNumber: number
  columnNumber: number
}

/**
 * Answers a break location request as the debugger does, so both run harnesses honour the range the run asks for: only the locations from `start` up to, and not including, `end`; without an `end` the range runs to the end of the module.
 * Called by {@link configuredRuntimeHarness} and {@link nativeParticipantsHarness} for `Debugger.getPossibleBreakpoints`.
 * @param locations - Every break location the test's debugger has in the module.
 * @param start - First place of the requested range.
 * @param end - The place the range ends before; absent for a request without an end.
 * @returns The locations inside the range, in the given order.
 * @example
 * breakLocationsInRange([{ lineNumber: 0, columnNumber: 6 }, { lineNumber: 1, columnNumber: 0 }], { lineNumber: 0, columnNumber: 0 }, { lineNumber: 1, columnNumber: 0 })
 * // => [{ lineNumber: 0, columnNumber: 6 }]
 */
export function breakLocationsInRange(
  locations: readonly GeneratedPlace[],
  start: GeneratedPlace,
  end?: GeneratedPlace,
): GeneratedPlace[] {
  return locations.filter(
    (location) =>
      !isGeneratedPlaceBefore(location, start) &&
      (!end || isGeneratedPlaceBefore(location, end)),
  )
}

/** Tells {@link breakLocationsInRange} whether one generated place lies before another. @example isGeneratedPlaceBefore({ lineNumber: 0, columnNumber: 6 }, { lineNumber: 1, columnNumber: 0 }) // true */
function isGeneratedPlaceBefore(
  left: GeneratedPlace,
  right: GeneratedPlace,
): boolean {
  return (
    left.lineNumber < right.lineNumber ||
    (left.lineNumber === right.lineNumber &&
      left.columnNumber < right.columnNumber)
  )
}
