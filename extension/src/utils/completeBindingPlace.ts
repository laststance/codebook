/** A one-based source position. */
type SourcePlace = { line: number; column: number }

/** A binding's whole place, with where its column was taken from: the binding itself, the adapter's own report of that breakpoint, or the paused top frame. */
export type CompletedBindingPlace = SourcePlace & {
  columnFrom: 'binding' | 'adapter' | 'paused-frame'
}

/**
 * Reads the column a place lends to a binding on one line, for the two places {@link completeBindingPlace} may borrow from.
 * @param line - The binding's line.
 * @param place - The adapter's report, or the paused top frame; `undefined` when there is none.
 * @returns The place's column when it lies on that line; `undefined` for a place on another line and for no place.
 * @example
 * columnOnLine(32, { line: 32, column: 11 }) // => 11
 * columnOnLine(32, { line: 35, column: 5 })  // => undefined
 */
function columnOnLine(
  line: number,
  place: SourcePlace | undefined,
): number | undefined {
  return place?.line === line ? place.column : undefined
}

/**
 * Gives a verified binding that names its line and no column the column it lost, so a stop requested at column 1 is not refused for it; {@link ConfiguredBrowserRun} calls it wherever it reads a binding from the editor.
 * VS Code and Cursor drop the column from the adapter's news about a breakpoint that has no column of its own. The line is never taken from anything but the binding: a column is only borrowed from a place on that same line.
 * @param binding - The verified binding as the editor answered it: its line, and its column when the editor kept one.
 * @param reported - Where the adapter itself reported that breakpoint verified, read before the editor dropped the column ({@link OwnedRepositoryBreakpoint.reportedPlace}); `undefined` when it named no whole position.
 * @param paused - The source place of the paused top frame, when the binding is read at the stop's pause; left out where no pause can vouch for a column.
 * @returns
 * - The binding's own line and column when it names both
 * - Its line with the adapter's column, when the adapter reported the breakpoint on that line
 * - Its line with the paused frame's column, when the adapter named none there and the frame is on that line
 * - `undefined` when neither names a column on the binding's line
 * @example
 * completeBindingPlace({ line: 32 }, { line: 32, column: 11 }) // => { line: 32, column: 11, columnFrom: 'adapter' }
 * completeBindingPlace({ line: 32 }, undefined, { line: 32, column: 11 }) // => { line: 32, column: 11, columnFrom: 'paused-frame' }
 * completeBindingPlace({ line: 32 }, undefined, { line: 35, column: 5 }) // => undefined
 */
export function completeBindingPlace(
  binding: { line: number; column?: number },
  reported: SourcePlace | undefined,
  paused?: SourcePlace,
): CompletedBindingPlace | undefined {
  const { line, column } = binding
  if (column !== undefined) return { line, column, columnFrom: 'binding' }
  // The adapter's own report comes first: it is that breakpoint's place, and the paused frame is only where the program stands.
  const reportedColumn = columnOnLine(line, reported)
  if (reportedColumn !== undefined)
    return { line, column: reportedColumn, columnFrom: 'adapter' }
  const pausedColumn = columnOnLine(line, paused)
  return pausedColumn === undefined
    ? undefined
    : { line, column: pausedColumn, columnFrom: 'paused-frame' }
}
