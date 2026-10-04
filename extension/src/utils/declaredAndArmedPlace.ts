/** A one-based source position. */
type SourcePosition = { line: number; column: number }

/**
 * Names a stop's declared place and, only when it differs, the place its breakpoint was requested at, for the journal entries `breakpoint.bound` and `breakpoint.pause-binding` that {@link ConfiguredBrowserRun} writes when a stop is bound; {@link journaledBindingOfSnapshot} reads the same two fields back for the live inspection resource.
 * @param declared - The position the agent declared for the stop.
 * @param armed - The position Codebook requested the breakpoint at: the declared one, or another one when the declared line has no mapped position.
 * @returns
 * - `{ declared }` when the breakpoint was requested at the declared position
 * - `{ declared, armed }` when the requested line or column differs from the declared one
 * @example
 * declaredAndArmedPlace({ line: 1, column: 1 }, { line: 1, column: 1 }) // => { declared: { line: 1, column: 1 } }
 * declaredAndArmedPlace({ line: 1, column: 1 }, { line: 2, column: 1 }) // => { declared: { line: 1, column: 1 }, armed: { line: 2, column: 1 } }
 */
export function declaredAndArmedPlace(
  declared: SourcePosition,
  armed: SourcePosition,
): { declared: SourcePosition; armed?: SourcePosition } {
  const declaredPlace = { line: declared.line, column: declared.column }
  // A request at the declared position is not repeated under a second name.
  if (armed.line === declared.line && armed.column === declared.column)
    return { declared: declaredPlace }
  return {
    declared: declaredPlace,
    armed: { line: armed.line, column: armed.column },
  }
}
