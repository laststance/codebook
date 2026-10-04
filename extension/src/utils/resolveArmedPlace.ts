import type { MappedPositionsScan } from './sourceMapMappedPositions'

/**
 * Chooses the position a declared stop's breakpoint is requested at, so a stop declared on a line the debugger cannot bind still has a place: {@link ConfiguredBrowserRun} asks once per stop at preparation, requests the breakpoint there when the stop is armed and measures the stop's binding rule ({@link createBindingLineRule}) from that line.
 * The debugger verifies no breakpoint that is requested on a line the sealed map has no position on (a blank line, a comment, the `>` that closes an opening tag): natively a browser stop there was never verified and a server stop was never registered or never hit. The first mapped position after such a line, within the stop's citation, is what a refusal's hints told an agent to declare instead.
 * @param declared - The one-based position the agent declared the stop at.
 * @param scan - The stop's one scan of its sealed map, from the declared line to the last line of its citation; a place after the citation is never the stop.
 * @returns
 * - `declared` itself when its line has a mapped position (found by a complete or a partial scan), when no later line of the citation has one, and when the map was too large to scan completely: a partial scan may have missed the declared line or an earlier mapped line, so the run decides that stop's place from the debugger's break locations when it arms it
 * - The first mapped position of the first later mapped line of the citation otherwise
 * @example
 * resolveArmedPlace({ line: 38, column: 1 }, { positions: [{ line: 39, column: 9 }], complete: true }) // => { line: 39, column: 9 } for a blank line 38
 * resolveArmedPlace({ line: 39, column: 9 }, { positions: [{ line: 39, column: 9 }], complete: true }) // => the declared position
 */
export function resolveArmedPlace(
  declared: { line: number; column: number },
  scan: MappedPositionsScan,
): { line: number; column: number } {
  const first = scan.positions[0]
  if (!scan.complete || !first || first.line === declared.line) return declared
  return { line: first.line, column: first.column }
}
