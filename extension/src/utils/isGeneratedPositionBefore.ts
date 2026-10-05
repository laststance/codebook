/** A zero-based position in generated code, named as the debugger protocol names a location's line and column. */
export interface GeneratedPosition {
  lineNumber: number
  columnNumber: number
}

/**
 * Tells whether one generated position lies before another in a module's text, so places of a generated module are ordered as the debugger walks them; {@link sourceMapGeneratedRange} asks it while it widens a line's range, and {@link breakLocationLinesOnTheWay} for every break location it places between two generated places.
 * @param left - The position asked about.
 * @param right - The position it is compared with.
 * @returns
 * - `true` when `left` is on an earlier generated line, or on the same line at an earlier column
 * - `false` for the same position and for a later one
 * @example
 * isGeneratedPositionBefore({ lineNumber: 0, columnNumber: 9 }, { lineNumber: 1, columnNumber: 0 }) // => true
 * isGeneratedPositionBefore({ lineNumber: 1, columnNumber: 0 }, { lineNumber: 1, columnNumber: 0 }) // => false
 */
export function isGeneratedPositionBefore(
  left: GeneratedPosition,
  right: GeneratedPosition,
): boolean {
  return (
    left.lineNumber < right.lineNumber ||
    (left.lineNumber === right.lineNumber &&
      left.columnNumber < right.columnNumber)
  )
}
