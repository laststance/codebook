/**
 * Words the refusal of a breakpoint the debugger bound away from the position its stop was declared at, for an owner that captures its stop at exactly that position; {@link OwnedRepositoryBreakpoint.assertBoundAsDeclared} and {@link OwnedNodeTestRun} throw it before a test is resumed towards a stop that cannot be captured, or as soon as the adapter's news names the other place.
 * @param declared - The one-based line and column the stop was declared at.
 * @param bound - Where the debugger has the breakpoint: its line, and its column when one is known. Both editors answer a breakpoint requested at column 1 without a column once the adapter sent news about it, so a column may be missing.
 * @returns
 * - With a column: the sentence that names both positions and says to declare the bound one
 * - Without a column: the sentence that names the bound line and says to declare a statement of it
 * @example
 * boundElsewhereRefusalText({ line: 20, column: 5 }, { line: 20, column: 12 })
 * // => 'Declared breakpoint 20:5 is bound at 20:12; this stop is captured at its declared position, so declare 20:12 or another statement.'
 * boundElsewhereRefusalText({ line: 20, column: 1 }, { line: 22 })
 * // => 'Declared breakpoint 20:1 is bound on line 22; this stop is captured at its declared position, so declare a statement of line 22 or another statement.'
 */
export function boundElsewhereRefusalText(
  declared: { line: number; column: number },
  bound: { line: number; column?: number },
): string {
  const opening = `Declared breakpoint ${declared.line}:${declared.column} is bound`,
    reason = 'this stop is captured at its declared position'
  return bound.column === undefined
    ? `${opening} on line ${bound.line}; ${reason}, so declare a statement of line ${bound.line} or another statement.`
    : `${opening} at ${bound.line}:${bound.column}; ${reason}, so declare ${bound.line}:${bound.column} or another statement.`
}
