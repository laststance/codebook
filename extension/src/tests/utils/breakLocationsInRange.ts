/** A zero-based place in an executed module, as the debugger protocol names a location's line and column. */
export interface GeneratedPlace {
  lineNumber: number
  columnNumber: number
}

/** A generated place as a break location request names it, with the script it lies in. */
export type ScriptPlace = GeneratedPlace & { scriptId: string }

/** The range of one break location request as a run harness records it: plain copies of what the run sent. */
export interface BreakLocationRange {
  start: ScriptPlace
  end?: ScriptPlace
}

/**
 * Answers `Debugger.getPossibleBreakpoints` for both run harnesses and gives the range to record; called by {@link configuredRuntimeHarness} and {@link nativeParticipantsHarness} from their fake debugger connection.
 * The run's objects come from its own module context, so the recorded range is a plain copy a test can compare.
 * @param locations - Every break location the test's debugger has in the module.
 * @param scriptId - The script the answer names for each location.
 * @param range - The range the run asked for.
 * @returns `range`: the copy to record; `answer`: the reply, with the locations {@link breakLocationsInRange} finds inside the range.
 * @example
 * answerBreakLocationRequest([{ lineNumber: 0, columnNumber: 6 }], 'actual', { start: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 } })
 * // => { range: { start: { scriptId: 'actual', lineNumber: 0, columnNumber: 0 } }, answer: { locations: [{ scriptId: 'actual', lineNumber: 0, columnNumber: 6 }] } }
 */
export function answerBreakLocationRequest(
  locations: readonly GeneratedPlace[],
  scriptId: string,
  { start, end }: BreakLocationRange,
): { range: BreakLocationRange; answer: { locations: ScriptPlace[] } } {
  return {
    range: { start: { ...start }, ...(end ? { end: { ...end } } : {}) },
    answer: {
      locations: breakLocationsInRange(locations, start, end).map(
        (location) => ({ scriptId, ...location }),
      ),
    },
  }
}

/**
 * Answers a break location request as the debugger does, so both run harnesses honour the range the run asks for: only the locations from `start` up to, and not including, `end`; without an `end` the range runs to the end of the module.
 * Called by {@link answerBreakLocationRequest} for `Debugger.getPossibleBreakpoints`.
 * @param locations - Every break location the test's debugger has in the module.
 * @param start - First place of the requested range.
 * @param end - The place the range ends before; absent for a request without an end.
 * @returns The locations inside the range, in the given order.
 * @example
 * breakLocationsInRange([{ lineNumber: 0, columnNumber: 6 }, { lineNumber: 1, columnNumber: 0 }], { lineNumber: 0, columnNumber: 0 }, { lineNumber: 1, columnNumber: 0 })
 * // => [{ lineNumber: 0, columnNumber: 6 }]
 */
function breakLocationsInRange(
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
