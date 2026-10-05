import type { MappedPositionsScan } from './sourceMapMappedPositions'

/** What {@link findUnmappedDeclaredStop} reads of a prepared stop: its declared line and the one scan of its sealed map, which starts at that line. */
interface ScannedStop {
  source: { line: number }
  scan: MappedPositionsScan
}

/**
 * Finds the first declared stop that can never bind: its line has no mapped position in its sealed module and the caller's rule finds no other way for it to bind. {@link ConfiguredBrowserRun} refuses it at preparation, before any application effect.
 * It reads no map: each stop carries the scan that also chose where its breakpoint is requested ({@link resolveArmedPlace}).
 * @param stops - The prepared stops in their declared order.
 * @param canBindWithoutMappedLine - Asked only for a stop whose scan found no position on its declared line; `scanComplete` is `false` when the scan stopped at its size limit, so the missing position proves nothing by itself. Returning `true` leaves the stop to arming.
 * @returns
 * - The first stop, in declared order, whose line its scan found unmapped and that the rule does not let through
 * - `undefined` when every other stop's line is mapped
 * @example
 * findUnmappedDeclaredStop([stopOnMappedLine, stopOnBlankLine], () => false) // => stopOnBlankLine
 * findUnmappedDeclaredStop([stopOnMappedLine], () => false)                  // => undefined
 * findUnmappedDeclaredStop([stopOnBlankLineAboveItsStatement], () => true)   // => undefined
 */
export function findUnmappedDeclaredStop<Stop extends ScannedStop>(
  stops: readonly Stop[],
  canBindWithoutMappedLine: (stop: Stop, scanComplete: boolean) => boolean,
): Stop | undefined {
  return stops.find(
    (stop) =>
      // A position the scan found is a position, also when the scan stopped early; without one the caller's rule decides.
      !stop.scan.positions.some(
        (position) => position.line === stop.source.line,
      ) && !canBindWithoutMappedLine(stop, stop.scan.complete),
  )
}
