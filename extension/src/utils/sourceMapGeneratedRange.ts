import {
  walkSourceMapSegments,
  type SourceMapSegment,
} from './walkSourceMapSegments'

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
  /** Moves the range's start back to one of the line's mappings and opens that mapping's span. */
  const openSpan = (position: GeneratedPosition): void => {
    if (!start || isBefore(position, start)) start = position
    openSpanLine = position.lineNumber
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
        closeSpan(openSpanEnd(openSpanLine, position))
      if (!isMappingOfLine(original, selectedSourceIndex, line)) return
      openSpan(position)
    },
  )
  // The line's mapping was the last segment read: it governs to the end of its generated line.
  if (openSpanLine !== undefined)
    closeSpan({ lineNumber: openSpanLine + 1, columnNumber: 0 })
  return { range: start && end ? { start, end } : undefined, complete }
}

/**
 * Finds where the span of a mapping ends once the next segment is read; called by {@link sourceMapGeneratedRange} for each segment that follows one of the line's mappings.
 * @param openSpanLine - The zero-based generated line of the mapping whose span is open.
 * @param next - The generated position of the segment that follows it.
 * @returns That segment's position when both lie on one generated line, otherwise the start of the generated line after the mapping's own (the end of its line, exclusive).
 * @example
 * openSpanEnd(0, { lineNumber: 0, columnNumber: 6 }) // => { lineNumber: 0, columnNumber: 6 }
 * openSpanEnd(0, { lineNumber: 2, columnNumber: 4 }) // => { lineNumber: 1, columnNumber: 0 }
 */
function openSpanEnd(
  openSpanLine: number,
  next: GeneratedPosition,
): GeneratedPosition {
  return openSpanLine === next.lineNumber
    ? next
    : { lineNumber: openSpanLine + 1, columnNumber: 0 }
}

/**
 * Says whether a segment maps its generated code to the asked original line; called by {@link sourceMapGeneratedRange} for every segment.
 * @param original - The segment's original position, absent for a segment without an original.
 * @param selectedSourceIndex - Index of the cited original in the map's `sources`.
 * @param line - One-based original line.
 * @returns Whether the segment has an original in that source on that line.
 * @example
 * isMappingOfLine({ sourceIndex: 0, line: 1, column: 0 }, 0, 2) // => true
 * isMappingOfLine(undefined, 0, 2)                              // => false
 */
function isMappingOfLine(
  original: SourceMapSegment['original'],
  selectedSourceIndex: number,
  line: number,
): boolean {
  return (
    original?.sourceIndex === selectedSourceIndex && original.line + 1 === line
  )
}

/** Tells {@link sourceMapGeneratedRange} whether one generated position lies before another. @example isBefore({ lineNumber: 0, columnNumber: 9 }, { lineNumber: 1, columnNumber: 0 }) // true */
function isBefore(left: GeneratedPosition, right: GeneratedPosition): boolean {
  return (
    left.lineNumber < right.lineNumber ||
    (left.lineNumber === right.lineNumber &&
      left.columnNumber < right.columnNumber)
  )
}
