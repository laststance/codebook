import { walkSourceMapSegments } from './walkSourceMapSegments'

/** A zero-based position in generated code, named as the debugger protocol names a location's line and column. */
interface GeneratedPosition {
  lineNumber: number
  columnNumber: number
}

/**
 * Finds the generated range that holds every place a source map puts on one original line, so `Debugger.getPossibleBreakpoints` is asked for that line's break locations instead of a whole module's; {@link createBundleVerifier} calls it for a sealed map.
 * A mapping governs the generated code from its own position up to the next segment of its generated line, or to the end of that line when it is the last: a break location anywhere in that span belongs to the mapping's original line. The range can also hold places of other lines when the generated order differs from the source order, so the caller still maps each answered location back.
 * @param mappings - The map's VLQ `mappings` string.
 * @param selectedSourceIndex - Index of the cited original in the map's `sources`.
 * @param line - One-based original line.
 * @returns
 * - `range`: `start` is the first generated position mapped to the line; `end` is exclusive, as the protocol's `end` is, and lies where the span of the line's last mapping ends. Absent when the scan found no mapping of the line.
 * - `complete`: `false` when the scan stopped at its size limit, so a range, or its absence, may miss later mappings of the line
 * @example
 * sourceMapGeneratedRange('AAAA;AACA', 0, 2)
 * // => { range: { start: { lineNumber: 1, columnNumber: 0 }, end: { lineNumber: 2, columnNumber: 0 } }, complete: true }
 * sourceMapGeneratedRange('AAAA,MAAM;AACA', 0, 1).range?.end // => { lineNumber: 1, columnNumber: 0 }
 * sourceMapGeneratedRange('AAAA', 0, 2) // => { range: undefined, complete: true }
 */
export function sourceMapGeneratedRange(
  mappings: string,
  selectedSourceIndex: number,
  line: number,
): {
  range?: { start: GeneratedPosition; end: GeneratedPosition }
  complete: boolean
} {
  let start: GeneratedPosition | undefined,
    end: GeneratedPosition | undefined,
    // The generated line of the preceding segment while that segment is one of the line's mappings: the next segment decides where its span ends.
    openSpanLine: number | undefined
  /** Moves the range's end forward to the end of the open span. */
  const closeSpan = (spanEnd: GeneratedPosition): void => {
    if (!end || isBefore(end, spanEnd)) end = spanEnd
    openSpanLine = undefined
  }
  const complete = walkSourceMapSegments(
    mappings,
    ({ generatedLine, generatedColumn, original }) => {
      const position = {
        lineNumber: generatedLine,
        columnNumber: generatedColumn,
      }
      // The open span ends at this segment when both lie on one generated line, otherwise at the end of its own generated line.
      if (openSpanLine !== undefined)
        closeSpan(
          openSpanLine === generatedLine
            ? position
            : { lineNumber: openSpanLine + 1, columnNumber: 0 },
        )
      if (
        original?.sourceIndex !== selectedSourceIndex ||
        original.line + 1 !== line
      )
        return
      if (!start || isBefore(position, start)) start = position
      openSpanLine = generatedLine
    },
  )
  // The line's mapping was the last segment read: it governs to the end of its generated line.
  if (openSpanLine !== undefined)
    closeSpan({ lineNumber: openSpanLine + 1, columnNumber: 0 })
  return { range: start && end ? { start, end } : undefined, complete }
}

/** Tells {@link sourceMapGeneratedRange} whether one generated position lies before another. @example isBefore({ lineNumber: 0, columnNumber: 9 }, { lineNumber: 1, columnNumber: 0 }) // true */
function isBefore(left: GeneratedPosition, right: GeneratedPosition): boolean {
  return (
    left.lineNumber < right.lineNumber ||
    (left.lineNumber === right.lineNumber &&
      left.columnNumber < right.columnNumber)
  )
}
