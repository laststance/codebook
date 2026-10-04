import type { createBundleVerifier } from './createBundleVerifier'

/** Reads the sealed map's mapped positions in a line range; the scan says whether it covered the whole map. */
type MappedPositionsReader = ReturnType<
  typeof createBundleVerifier
>['mappedPositions']

/**
 * Chooses the position a declared stop's breakpoint is requested at, so a stop declared on a line the debugger cannot bind still has a place: {@link ConfiguredBrowserRun} asks once per stop at preparation, requests the breakpoint there when the stop is armed and measures the stop's binding rule ({@link createBindingLineRule}) from that line.
 * The debugger verifies no breakpoint that is requested on a line the sealed map has no position on (a blank line, a comment, the `>` that closes an opening tag): natively a browser stop there was never verified and a server stop was never registered or never hit. The first mapped position after such a line, within the stop's citation, is what a refusal's hints told an agent to declare instead.
 * @param declared - The one-based position the agent declared the stop at.
 * @param citationEndLine - The last line of the stop's citation; a place after it is never the stop.
 * @param mappedPositions - Reads the sealed map's mapped positions in a line range, as {@link createBundleVerifier} offers them; asked once.
 * @returns
 * - `declared` itself when its line has a mapped position, when no later line of the citation has one, and when the map was too large to scan completely (a partial scan may have missed an earlier mapped line)
 * - The first mapped position of the first later mapped line of the citation otherwise
 * @example
 * resolveArmedPlace({ line: 38, column: 1 }, 52, verifier.mappedPositions) // => { line: 39, column: 9 } for a blank line 38
 * resolveArmedPlace({ line: 39, column: 9 }, 52, verifier.mappedPositions) // => the declared position
 */
export function resolveArmedPlace<
  Declared extends { line: number; column: number },
>(
  declared: Declared,
  citationEndLine: number,
  mappedPositions: MappedPositionsReader,
): Declared | { line: number; column: number } {
  const scan = mappedPositions(declared.line, citationEndLine),
    first = scan.positions[0]
  if (!scan.complete || !first || first.line === declared.line) return declared
  return { line: first.line, column: first.column }
}
