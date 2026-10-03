import type { createBundleVerifier } from './createBundleVerifier'

/** Reads the sealed map's mapped positions in a line range; the scan says whether it covered the whole map. */
type MappedPositionsReader = ReturnType<
  typeof createBundleVerifier
>['mappedPositions']

/** A declared stop's rule for the line the debugger binds its breakpoint on, decided once from the sealed map. */
export interface BindingLineRule {
  /** Tells whether a line the debugger chose is this stop's place. */
  accepts(line: number): boolean
  /** Names the condition that refuses a line, for the failure an agent reads; `undefined` for an accepted line. */
  refusal(line: number): string | undefined
}

/**
 * Decides once, at preparation, which lines the debugger may bind a declared stop's breakpoint on, so the pause handler and every later check never decode the sealed map again.
 * A debugger that cannot pause on a line binds the first place after it, so a later line is the declared stop when the article shows it and nothing that could run lies between: every line from the declared one up to the first later line the map has a position on. {@link ConfiguredBrowserRun} builds one rule per stop and asks it wherever a binding or a pause is compared with that stop.
 * @param declaredLine - One-based line the agent declared the stop on; it lies within the citation.
 * @param citation - The stop's article excerpt; only its last line is needed, because an accepted bound line is never before the declared one.
 * @param mappedPositions - Reads the sealed map's mapped positions in a line range, as {@link createBundleVerifier} offers them; asked once.
 * @returns The rule:
 * - `accepts` is `true` on the declared line, and on a later whole line within the citation with no mapped line between
 * - `refusal` names an earlier line, a line after the citation, the mapped line between, or a scan that stopped at its size limit
 * @example
 * const rule = createBindingLineRule(22, { endLine: 95 }, verifier.mappedPositions)
 * rule.accepts(23) // => true: the debugger moved `return (` onto the `<form>` line
 * rule.refusal(21) // => 'line 21 is before the declared line 22'
 */
export function createBindingLineRule(
  declaredLine: number,
  citation: { endLine: number },
  mappedPositions: MappedPositionsReader,
): BindingLineRule {
  const later =
    declaredLine < citation.endLine
      ? mappedPositions(declaredLine + 1, citation.endLine)
      : { positions: [], complete: true }
  const firstMappedLine = later.positions[0]?.line
  const refusal = (line: number): string | undefined => {
    if (!Number.isInteger(line)) return `${line} is not a whole line number`
    if (line === declaredLine) return undefined
    if (line < declaredLine)
      return `line ${line} is before the declared line ${declaredLine}`
    if (line > citation.endLine)
      return `line ${line} is after the last line ${citation.endLine} of the citation`
    // The next line has nothing between, whatever the scan could cover.
    if (line === declaredLine + 1) return undefined
    if (firstMappedLine !== undefined && firstMappedLine < line)
      return `line ${firstMappedLine} between the declared line ${declaredLine} and line ${line} has a mapped position`
    // A scan that stopped at its size limit proves nothing about the lines it did not reach.
    if (!later.complete)
      return `the sealed map was too large to scan completely, so lines ${declaredLine + 1} to ${line - 1} between the declared line and line ${line} may hold code`
    return undefined
  }
  return {
    accepts: (line) => refusal(line) === undefined,
    refusal,
  }
}
