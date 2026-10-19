import type { GeneratedPosition } from './isGeneratedPositionBefore'

/**
 * Tells whether a generated place a judgement was made for is the place asked about now, so {@link ConfiguredBrowserRun} keeps a verdict of its binding rule only for the generated place it was built for.
 * @param judgedAt - The generated place the rule was built for; `undefined` when the judgement knew none.
 * @param askedAt - The generated place the binding is judged at now.
 * @returns `true` for the same generated line and column; `false` for another place, and when no place was known.
 * @example
 * isSameGeneratedPosition({ lineNumber: 32, columnNumber: 52 }, { lineNumber: 32, columnNumber: 52 }) // => true
 * isSameGeneratedPosition(undefined, { lineNumber: 32, columnNumber: 52 })                           // => false
 */
export function isSameGeneratedPosition(
  judgedAt: GeneratedPosition | undefined,
  askedAt: GeneratedPosition,
): boolean {
  return (
    judgedAt?.lineNumber === askedAt.lineNumber &&
    judgedAt.columnNumber === askedAt.columnNumber
  )
}
