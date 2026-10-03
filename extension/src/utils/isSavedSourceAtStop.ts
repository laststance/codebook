/** A one-based source position. */
type SourcePosition = { line: number; column: number }

/**
 * Tells whether the position a saved observation was captured at is the place of its declared stop, for {@link validateConfiguredStudyEvidence} when a study is decoded or reopened.
 * A run commits a stop where the debugger bound it: at another column of the declared line, or on a later line within the stop's citation when the debugger could not pause on the declared one. A saved study has no sealed map to repeat the run's check with, so any position other than the declared one counts only when the study also saved the native debugger state; the caller then requires that state's top frame at exactly this position.
 * @param observed - Where the saved observation says it was captured.
 * @param hasDebuggerState - Whether the observation saved the native debugger's frames, whose top frame confirms the position.
 * @param declared - The position the stop was declared at.
 * @param citation - The stop's article excerpt, or `undefined` when the study has none for it.
 * @returns
 * - `true` at the declared position
 * - `true` at another column of the declared line, or on a later line up to the citation's last line, when the debugger state was saved
 * - `false` otherwise: an earlier line, a line after the citation, or a moved position nothing confirms
 * @example
 * isSavedSourceAtStop({ line: 23, column: 5 }, true, { line: 22, column: 3 }, { endLine: 95 }) // => true
 * isSavedSourceAtStop({ line: 23, column: 5 }, false, { line: 22, column: 3 }, { endLine: 95 }) // => false
 */
export function isSavedSourceAtStop(
  observed: SourcePosition,
  hasDebuggerState: boolean,
  declared: SourcePosition,
  citation: { endLine: number } | undefined,
): boolean {
  if (observed.line === declared.line && observed.column === declared.column)
    return true
  // The debugger chose this position; only its saved top frame can confirm it.
  return (
    hasDebuggerState &&
    isFromDeclaredLineToCitationEnd(observed.line, declared.line, citation)
  )
}

/** Tells {@link isSavedSourceAtStop} whether a line lies from the declared line to the last line of the stop's citation; without a citation only the declared line does. @example isFromDeclaredLineToCitationEnd(23, 22, { endLine: 95 }) // true */
function isFromDeclaredLineToCitationEnd(
  line: number,
  declaredLine: number,
  citation: { endLine: number } | undefined,
): boolean {
  return line >= declaredLine && line <= (citation?.endLine ?? declaredLine)
}
