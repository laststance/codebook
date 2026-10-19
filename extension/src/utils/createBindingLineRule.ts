import type { MappedPositionsScan } from './sourceMapMappedPositions'

/** A declared stop's rule for the line the debugger binds its breakpoint on, decided once from the sealed map. */
export interface BindingLineRule {
  /** Tells whether a line the debugger chose is this stop's place. */
  accepts(line: number): boolean
  /** Names the condition that refuses a line, for the failure an agent reads; `undefined` for an accepted line. */
  refusal(line: number): string | undefined
}

/**
 * Decides, at preparation and once more when the debugger's break locations are read, which lines the debugger may bind a declared stop's breakpoint on, so the pause handler and every later check never read the sealed map.
 * The rule is measured from the line the stop's breakpoint is requested on. A debugger that cannot pause at the requested place binds the first place after it, so a later line is the stop when the article shows it and nothing that could run lies between it and the requested line: accepted are the lines from the declared to the requested one, the line after the requested one, and every later line of the citation up to the first line after the requested one that the map has a position on (or, given the debugger's break locations, that has one). {@link ConfiguredBrowserRun} builds one rule per stop and asks it wherever a binding or a pause is compared with that stop; it builds the rule again from the break locations when a binding on a later line is refused by the map alone.
 * A generated module does not keep the order of its source, so for the one binding the debugger was asked about, a line lies between only when its break location lies between the two generated places ({@link breakLocationLinesOnTheWay}); every other line is still measured by all lines with a break location.
 * @param declaredLine - One-based line the agent declared the stop on; it lies within the citation.
 * @param citation - The stop's article excerpt; only its last line is needed, because an accepted bound line is never before the declared one.
 * @param scan - The stop's one scan of its sealed map, from the declared line to the last line of its citation; the rule reads the first mapped line after the requested one from it.
 * @param requestedLine - The line the stop's breakpoint is requested on ({@link resolveArmedPlace}): the declared line, or, for a stop declared on a line without a mapped position, the first mapped line after it. The rule is measured from this line, because a debugger that cannot pause there either binds the first place after it, exactly as for a stop declared there.
 * @param breakLocationLines - The source lines of the module on which the debugger itself lists a break location, when {@link ConfiguredBrowserRun} asked it for a binding the map rule refuses. With them only such a line lies between: a mapped line where the debugger cannot pause (a function head, its parameters, `try {`) is passed over like a comment, and the scan's size limit no longer matters, because the debugger's list covers the whole module. Without them the scan's mapped lines decide.
 * @param judgedBinding - The one binding whose generated place is known, when {@link ConfiguredBrowserRun} judged it by the debugger's break locations: its line, and the source lines of the break locations that lie in the generated module between the place the breakpoint was requested at and the place of that binding ({@link breakLocationLinesOnTheWay}). For that line only these lines lie between: a break location elsewhere in the generated module that the map puts on a line between the two refuses nothing. Every other line is measured by `breakLocationLines`, so the rule is never more permissive for a binding nobody judged.
 * @returns The rule:
 * - `accepts` is `true` from the declared line to the requested one, and on a later whole line within the citation with no mapped line (or, given break locations, no line with a break location) between it and the requested line
 * - `refusal` names an earlier line, a line after the citation, the mapped line or the line with a break location between the requested and the bound line, or a scan that stopped at its size limit, with the line to declare instead; the last two name the requested line the lines are counted from
 * @example
 * const rule = createBindingLineRule(22, { endLine: 95 }, verifier.mappedPositions(22, 95), 22)
 * rule.accepts(23) // => true: the debugger moved `return (` onto the `<form>` line
 * rule.refusal(21) // => 'line 21 is before the declared line 22'
 * createBindingLineRule(73, { endLine: 95 }, verifier.mappedPositions(73, 95), 74).accepts(75) // => true: requested on 74, the first mapped line after the unmapped 73, and bound on the next line
 * createBindingLineRule(26, { endLine: 41 }, verifier.mappedPositions(26, 41), 26, [26, 32, 33]).accepts(32) // => true: lines 27 to 31 are mapped, but the debugger cannot pause on any of them
 * createBindingLineRule(26, { endLine: 41 }, verifier.mappedPositions(26, 41), 26, [27, 32], { line: 32, breakLocationLinesBetween: [] }).accepts(32) // => true: line 27 has a break location, but at the end of the generated module, after the binding's
 */
export function createBindingLineRule(
  declaredLine: number,
  citation: { endLine: number },
  scan: MappedPositionsScan,
  requestedLine: number,
  breakLocationLines?: readonly number[],
  judgedBinding?: {
    line: number
    breakLocationLinesBetween: readonly number[]
  },
): BindingLineRule {
  // The debugger's own break locations, when it was asked, decide which later line could run before the bound one; otherwise the sealed map's mapped lines do.
  const linesThatCouldRun =
      breakLocationLines ?? scan.positions.map((position) => position.line),
    lineBetweenReason = breakLocationLines
      ? 'has a break location'
      : 'has a mapped position',
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
   * Chooses the lines a bound line is measured by; called by {@link lineBetweenRefusal}.
   * @param line - The line the debugger chose.
   * @returns For the judged binding's line, the lines whose break location lies between the two generated places: only they were passed over. For every other line, all lines that could run.
   * @example
   * linesMeasuring(32) // => [] for a judged binding on line 32 that nothing lies before in the generated module
   */
  const linesMeasuring = (line: number): readonly number[] =>
    line === judgedBinding?.line
      ? judgedBinding.breakLocationLinesBetween
      : linesThatCouldRun
  /**
   * Refuses a line when a line that could run lies between it and the requested line; the first check of {@link unprovenGapRefusal}.
   * @param line - The line the debugger chose, more than one after the requested line.
   * @returns The mapped line (or, given break locations, the line with a break location) between the two; `undefined` when the first such line after the requested one is not before `line`, or there is none. The judged binding's line is measured by the lines between the two generated places, every other line by all lines.
   * @example
   * lineBetweenRefusal(30) // => 'line 25 between the declared line 22 and line 30 has a mapped position'
   */
  const lineBetweenRefusal = (line: number): string | undefined => {
    const firstLineBetween = linesMeasuring(line)
      .filter((candidate) => candidate > requestedLine)
      .sort((left, right) => left - right)[0]
    return firstLineBetween !== undefined && firstLineBetween < line
      ? `line ${firstLineBetween} between ${requestedAt} and line ${line} ${lineBetweenReason}`
      : undefined
  }
  /**
   * Refuses a line when the scan could not prove that nothing lies between it and the requested line; the second check of {@link unprovenGapRefusal}, asked when no known line lies between.
   * @param line - The line the debugger chose, more than one after the requested line.
   * @returns That the scan stopped at its size limit, with the line to declare instead; `undefined` for a complete scan, and given break locations.
   * @example
   * incompleteScanRefusal(30) // => 'the sealed map was too large to scan completely, so lines 23 to 29 between the declared line 22 and line 30 may hold code; declare the stop on line 30, where the debugger bound it'
   */
  const incompleteScanRefusal = (line: number): string | undefined =>
    // A scan that stopped at its size limit proves nothing about the lines it did not reach; the debugger's own list of break locations covers them.
    !scan.complete && !breakLocationLines
      ? `the sealed map was too large to scan completely, so lines ${requestedLine + 1} to ${line - 1} between ${requestedAt} and line ${line} may hold code; declare the stop on line ${line}, where the debugger bound it`
      : undefined
  /**
   * Refuses a line when code may lie between it and the requested line; called by {@link gapRefusal} for a line more than one after the requested line.
   * @param line - The line the debugger chose.
   * @returns The mapped line (or, given break locations, the line with a break location) between the two ({@link lineBetweenRefusal}), or that the scan stopped at its size limit before it could prove there is none ({@link incompleteScanRefusal}); `undefined` when there is none.
   * @example
   * unprovenGapRefusal(30) // => 'line 25 between the declared line 22 and line 30 has a mapped position'
   */
  const unprovenGapRefusal = (line: number): string | undefined =>
    lineBetweenRefusal(line) ?? incompleteScanRefusal(line)
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
