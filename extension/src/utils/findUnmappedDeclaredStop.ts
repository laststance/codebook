/** What {@link findUnmappedDeclaredStop} reads of a prepared stop: its declared place and its sealed module's map reader. */
interface MappedStop {
  source: { path: string; line: number }
  verifier: {
    hashes: { sourceMap: string }
    mappedPositions(
      startLine: number,
      endLine: number,
    ): { positions: { line: number }[]; complete: boolean }
  }
}

/**
 * Finds the first declared stop that can never bind: its line has no mapped position in its sealed module and the caller's rule finds no other way for it to bind. {@link ConfiguredBrowserRun} refuses it at preparation, before any application effect.
 * Stops of one module share one scan of its map over the lines they declare.
 * @param stops - The prepared stops in their declared order.
 * @param canBindWithoutMappedLine - Asked only for a stop the scan found no position for on its declared line; `scanComplete` is `false` when the scan stopped at its size limit, so the missing position proves nothing by itself. Returning `true` leaves the stop to arming.
 * @returns
 * - The first stop, in declared order, whose line the scan found unmapped and that the rule does not let through
 * - `undefined` when every other stop's line is mapped
 * @example
 * findUnmappedDeclaredStop([stopOnMappedLine, stopOnBlankLine], () => false) // => stopOnBlankLine
 * findUnmappedDeclaredStop([stopOnMappedLine], () => false)                  // => undefined
 * findUnmappedDeclaredStop([stopOnBlankLineAboveItsStatement], () => true)   // => undefined
 */
export function findUnmappedDeclaredStop<Stop extends MappedStop>(
  stops: readonly Stop[],
  canBindWithoutMappedLine: (stop: Stop, scanComplete: boolean) => boolean,
): Stop | undefined {
  const scansByModule = new Map<
    string,
    { mappedLines: Set<number>; complete: boolean }
  >()
  for (const stop of stops) {
    const moduleKey = sealedModuleKey(stop)
    let scan = scansByModule.get(moduleKey)
    // One scan covers every line the stops of this module declare.
    if (!scan) {
      const declaredLines = stops
          .filter((other) => sealedModuleKey(other) === moduleKey)
          .map((other) => other.source.line),
        mapped = stop.verifier.mappedPositions(
          Math.min(...declaredLines),
          Math.max(...declaredLines),
        )
      scan = {
        mappedLines: new Set(mapped.positions.map((position) => position.line)),
        complete: mapped.complete,
      }
      scansByModule.set(moduleKey, scan)
    }
    // A position the scan found is a position, also when the scan stopped early; without one the caller's rule decides.
    if (
      !scan.mappedLines.has(stop.source.line) &&
      !canBindWithoutMappedLine(stop, scan.complete)
    )
      return stop
  }
  return undefined
}

/** Identifies the sealed module a stop belongs to by its map and original path. @example sealedModuleKey(stop) */
function sealedModuleKey(stop: MappedStop): string {
  return `${stop.verifier.hashes.sourceMap}\n${stop.source.path}`
}
