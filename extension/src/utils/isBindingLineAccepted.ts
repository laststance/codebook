import type { createBundleVerifier } from './createBundleVerifier'

/** Reads the sealed map's mapped positions in a line range; the scan says whether it covered the whole map. */
type MappedPositionsReader = ReturnType<
  typeof createBundleVerifier
>['mappedPositions']

/**
 * Tells whether the line the debugger verified a declared stop's breakpoint on is that stop's place.
 * A debugger that cannot pause on a line binds the breakpoint on the first place after it, so a later line is the declared stop when the article shows it and nothing that could run lies between. {@link ConfiguredBrowserRun} asks this wherever a binding or a pause is compared with a declared stop: when a browser stop is armed, when the server's adapter acknowledges a registration, when a pause is admitted and inspected, and when a paused stack is refreshed.
 * @param declaredLine - One-based line the agent declared the stop on; it lies within the citation.
 * @param boundLine - One-based line the debugger verified the breakpoint on.
 * @param citation - The stop's article excerpt; only its last line is needed, because an accepted bound line is never before the declared one.
 * @param mappedPositions - Reads the sealed map's mapped positions in a line range, as {@link createBundleVerifier} offers them.
 * @returns
 * - `true` on the declared line, and on a later line within the citation when no line between the two has a mapped position
 * - `false` on an earlier line, on a line after the citation, and across a line that has a mapped position or that a scan stopped at its size limit could not rule out
 * @example
 * isBindingLineAccepted(22, 23, { endLine: 95 }, verifier.mappedPositions) // => true: the debugger moved `return (` onto the `<form>` line
 * isBindingLineAccepted(22, 21, { endLine: 95 }, verifier.mappedPositions) // => false: an earlier line
 */
export function isBindingLineAccepted(
  declaredLine: number,
  boundLine: number,
  citation: { endLine: number },
  mappedPositions: MappedPositionsReader,
): boolean {
  if (boundLine === declaredLine) return true
  // A debugger moves a breakpoint forward only, and a line after the citation is one the article does not show.
  if (boundLine < declaredLine || boundLine > citation.endLine) return false
  return hasNoMappedLineBetween(declaredLine, boundLine, mappedPositions)
}

/** Tells {@link isBindingLineAccepted} that no line strictly between two lines holds code the sealed map knows of. @example hasNoMappedLineBetween(22, 23, verifier.mappedPositions) // true: nothing lies between */
function hasNoMappedLineBetween(
  declaredLine: number,
  boundLine: number,
  mappedPositions: MappedPositionsReader,
): boolean {
  // The next line has nothing between, whatever the scan could cover.
  if (boundLine === declaredLine + 1) return true
  const between = mappedPositions(declaredLine + 1, boundLine - 1)
  // A scan that stopped at its size limit proves nothing about the lines it did not reach.
  return between.complete && between.positions.length === 0
}
