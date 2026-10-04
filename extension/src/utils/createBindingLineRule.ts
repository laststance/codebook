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
 * The rule is measured from the line the stop's breakpoint is requested on. A debugger that cannot pause at the requested place binds the first place after it, so a later line is the stop when the article shows it and nothing that could run lies between it and the requested line: accepted are the lines from the declared to the requested one, the line after the requested one, and every later line of the citation up to the first line after the requested one that the map has a position on. {@link ConfiguredBrowserRun} builds one rule per stop and asks it wherever a binding or a pause is compared with that stop.
 * @param declaredLine - One-based line the agent declared the stop on; it lies within the citation.
 * @param citation - The stop's article excerpt; only its last line is needed, because an accepted bound line is never before the declared one.
 * @param scan - The stop's one scan of its sealed map, from the declared line to the last line of its citation; the rule reads the first mapped line after the requested one from it.
 * @param requestedLine - The line the stop's breakpoint is requested on ({@link resolveArmedPlace}): the declared line, or, for a stop declared on a line without a mapped position, the first mapped line after it. The rule is measured from this line, because a debugger that cannot pause there either binds the first place after it, exactly as for a stop declared there.
 * @returns The rule:
 * - `accepts` is `true` from the declared line to the requested one, and on a later whole line within the citation with no mapped line between it and the requested line
 * - `refusal` names an earlier line, a line after the citation, the mapped line between the requested and the bound line, or a scan that stopped at its size limit, with the line to declare instead; the last two name the requested line the lines are counted from
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
  /**
   * Refuses a later line that lies outside the stop; called by {@link refusal} for a line that is whole and not the declared one.
   * @param line - The line the debugger chose.
   * @returns The condition for a line before the declared one or after the citation's last line; `undefined` for a line between them.
   * @example
   * outsideStopRefusal(21) // => 'line 21 is before the declared line 22'
   */
  const outsideStopRefusal = (line: number): string | undefined => {
    if (line < declaredLine)
      return `line ${line} is before the declared line ${declaredLine}`
    if (line > citation.endLine)
      return `line ${line} is after the last line ${citation.endLine} of the citation`
    return undefined
  }
  /**
   * Refuses a line when code may lie between it and the requested line; called by {@link gapRefusal} for a line more than one after the requested line.
   * @param line - The line the debugger chose.
   * @returns The mapped line between the two, or that the scan stopped at its size limit before it could prove there is none; `undefined` when the scan found none.
   * @example
   * unprovenGapRefusal(30) // => 'line 25 between the declared line 22 and line 30 has a mapped position'
   */
  const unprovenGapRefusal = (line: number): string | undefined => {
    if (firstMappedLine !== undefined && firstMappedLine < line)
      return `line ${firstMappedLine} between ${requestedAt} and line ${line} has a mapped position`
    // A scan that stopped at its size limit proves nothing about the lines it did not reach.
    if (!scan.complete)
      return `the sealed map was too large to scan completely, so lines ${requestedLine + 1} to ${line - 1} between ${requestedAt} and line ${line} may hold code; declare the stop on line ${line}, where the debugger bound it`
    return undefined
  }
  /**
   * Measures a line within the stop from the requested line; called by {@link refusal} once the line lies between the declared line and the citation's end.
   * @param line - The line the debugger chose.
   * @returns `undefined` up to the line after the requested one; for a later line what {@link unprovenGapRefusal} finds.
   * @example
   * gapRefusal(23) // => undefined: the line after the requested line 22
   */
  const gapRefusal = (line: number): string | undefined => {
    // No line from the declared one up to the requested one has a mapped position before the requested line itself.
    if (line <= requestedLine) return undefined
    // The next line has nothing between, whatever the scan could cover.
    if (line === requestedLine + 1) return undefined
    return unprovenGapRefusal(line)
  }
  /**
   * Names the condition that refuses a line the debugger chose; it is the rule's `refusal`, and `accepts` asks it too.
   * @param line - The line the debugger chose.
   * @returns The first condition that refuses the line, in this order: no whole number, before the declared line, after the citation, a mapped line between, an incomplete scan; `undefined` for an accepted line.
   * @example
   * refusal(21) // => 'line 21 is before the declared line 22'
   * refusal(22) // => undefined
   */
  const refusal = (line: number): string | undefined => {
    if (!Number.isInteger(line)) return `${line} is not a whole line number`
    if (line === declaredLine) return undefined
    return outsideStopRefusal(line) ?? gapRefusal(line)
  }
  return {
    accepts: (line) => refusal(line) === undefined,
    refusal,
  }
}
