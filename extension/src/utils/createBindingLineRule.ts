import type { MappedPositionsScan } from './sourceMapMappedPositions'

/** A declared stop's rule for the line the debugger binds its breakpoint on, decided once from the sealed map. */
export interface BindingLineRule {
  /** Tells whether a line the debugger chose is this stop's place. */
  accepts(line: number): boolean
  /** Names the condition that refuses a line, for the failure an agent reads; `undefined` for an accepted line. */
  refusal(line: number): string | undefined
}

/**
 * Decides once, at preparation, which lines the debugger may bind a declared stop's breakpoint on, so the pause handler and every later check never read the sealed map.
 * A debugger that cannot pause on a line binds the first place after it, so a later line is the declared stop when the article shows it and nothing that could run lies between: every line from the declared one up to the first later line the map has a position on. {@link ConfiguredBrowserRun} builds one rule per stop and asks it wherever a binding or a pause is compared with that stop.
 * @param declaredLine - One-based line the agent declared the stop on; it lies within the citation.
 * @param citation - The stop's article excerpt; only its last line is needed, because an accepted bound line is never before the declared one.
 * @param scan - The stop's one scan of its sealed map, from the declared line to the last line of its citation; the rule reads the first mapped line after the requested one from it.
 * @param requestedLine - The line the stop's breakpoint is requested on ({@link resolveArmedPlace}): the declared line, or, for a stop declared on a line without a mapped position, the first mapped line after it. The rule is measured from this line, because a debugger that cannot pause there either binds the first place after it, exactly as for a stop declared there.
 * @returns The rule:
 * - `accepts` is `true` from the declared line to the requested one, and on a later whole line within the citation with no mapped line between it and the requested line
 * - `refusal` names an earlier line, a line after the citation, the mapped line between, or a scan that stopped at its size limit
 * @example
 * const rule = createBindingLineRule(22, { endLine: 95 }, verifier.mappedPositions(22, 95), 22)
 * rule.accepts(23) // => true: the debugger moved `return (` onto the `<form>` line
 * rule.refusal(21) // => 'line 21 is before the declared line 22'
 * createBindingLineRule(73, { endLine: 95 }, verifier.mappedPositions(73, 95), 74).accepts(75) // => true: requested on 74, the first mapped line after the unmapped 73, and bound on the next line
 */
export function createBindingLineRule(
  declaredLine: number,
  citation: { endLine: number },
  scan: MappedPositionsScan,
  requestedLine: number,
): BindingLineRule {
  const firstMappedLine = scan.positions.find(
      (position) => position.line > requestedLine,
    )?.line,
    // A stop requested after its declared line names both in a refusal, so an agent sees which line the rule was measured from.
    requestedAt =
      requestedLine === declaredLine
        ? `the declared line ${declaredLine}`
        : `line ${requestedLine}, where the stop declared on line ${declaredLine} was requested,`
  const refusal = (line: number): string | undefined => {
    if (!Number.isInteger(line)) return `${line} is not a whole line number`
    if (line === declaredLine) return undefined
    if (line < declaredLine)
      return `line ${line} is before the declared line ${declaredLine}`
    if (line > citation.endLine)
      return `line ${line} is after the last line ${citation.endLine} of the citation`
    // No line from the declared one up to the requested one has a mapped position before the requested line itself.
    if (line <= requestedLine) return undefined
    // The next line has nothing between, whatever the scan could cover.
    if (line === requestedLine + 1) return undefined
    if (firstMappedLine !== undefined && firstMappedLine < line)
      return `line ${firstMappedLine} between ${requestedAt} and line ${line} has a mapped position`
    // A scan that stopped at its size limit proves nothing about the lines it did not reach.
    if (!scan.complete)
      return `the sealed map was too large to scan completely, so lines ${requestedLine + 1} to ${line - 1} between the declared line and line ${line} may hold code`
    return undefined
  }
  return {
    accepts: (line) => refusal(line) === undefined,
    refusal,
  }
}
