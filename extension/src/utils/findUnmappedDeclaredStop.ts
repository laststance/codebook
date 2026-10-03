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
 * Finds the first declared stop whose line has no mapped position in its sealed module, for the refusal {@link ConfiguredBrowserRun} raises at preparation, before any application effect.
 * Stops of one module share one scan of its map over the lines they declare; a scan that stopped at its size limit proves nothing, so arming decides for those stops.
 * @param stops - The prepared stops in their declared order.
 * @returns
 * - The first stop, in declared order, whose line a complete scan found unmapped
 * - `undefined` when every line is mapped or no scan was complete
 * @example
 * findUnmappedDeclaredStop([stopOnMappedLine, stopOnBlankLine]) // => stopOnBlankLine
 * findUnmappedDeclaredStop([stopOnMappedLine])                  // => undefined
 */
export function findUnmappedDeclaredStop<Stop extends MappedStop>(
  stops: readonly Stop[],
): Stop | undefined {
  const mappedLinesByModule = new Map<string, Set<number> | undefined>()
  for (const stop of stops) {
    const moduleKey = sealedModuleKey(stop)
    // One scan covers every line the stops of this module declare.
    if (!mappedLinesByModule.has(moduleKey)) {
      const declaredLines = stops
          .filter((other) => sealedModuleKey(other) === moduleKey)
          .map((other) => other.source.line),
        scan = stop.verifier.mappedPositions(
          Math.min(...declaredLines),
          Math.max(...declaredLines),
        )
      mappedLinesByModule.set(
        moduleKey,
        scan.complete
          ? new Set(scan.positions.map((position) => position.line))
          : undefined,
      )
    }
    const mappedLines = mappedLinesByModule.get(moduleKey)
    if (mappedLines && !mappedLines.has(stop.source.line)) return stop
  }
  return undefined
}

/** Identifies the sealed module a stop belongs to by its map and original path. @example sealedModuleKey(stop) */
function sealedModuleKey(stop: MappedStop): string {
  return `${stop.verifier.hashes.sourceMap}\n${stop.source.path}`
}
