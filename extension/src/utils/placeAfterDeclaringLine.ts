import type { MappedPositionsScan } from './sourceMapMappedPositions'

/**
 * Chooses where a stop whose own line declares a binding it requires is requested: the first mapped position of the first mapped line after the declaring statement, within the stop's citation, because the debugger pauses before a line runs and the binding has a value only once its whole statement has run.
 * {@link ConfiguredBrowserRun} asks it at preparation, before {@link resolveArmedPlace}, for a stop whose declared line {@link declaredInspectionBindings} finds declaring a required binding, with the statement's last line from {@link declarationStatementEndLine}.
 * @param declaringLine - The one-based last line of the declaring statement (the stop's declared line for a one-line declaration).
 * @param scan - The stop's one scan of its sealed map, from the declared line to the last line of its citation; a place after the citation is never the stop.
 * @returns
 * - The first mapped position of the first mapped line after `declaringLine` that a complete scan found
 * - For a scan that stopped at its size limit, that position only when it lies on the very next line, since a missing line between proves nothing then
 * - `undefined` when no later line of the citation has a mapped position, or the partial scan found none on the next line: the stop stays where it was declared
 * @example
 * placeAfterDeclaringLine(21, { positions: [{ line: 21, column: 3 }, { line: 22, column: 3 }], complete: true }) // => { line: 22, column: 3 }
 * placeAfterDeclaringLine(21, { positions: [{ line: 21, column: 3 }], complete: true })                         // => undefined
 */
export function placeAfterDeclaringLine(
  declaringLine: number,
  scan: MappedPositionsScan,
): { line: number; column: number } | undefined {
  const next = scan.positions.find((position) => position.line > declaringLine)
  if (!next) return undefined
  // A partial scan may have missed a mapped line between, except when the line it found is the very next one.
  if (!scan.complete && next.line !== declaringLine + 1) return undefined
  return { line: next.line, column: next.column }
}
