import {
  walkSourceMapSegments,
  type SourceMapSegment,
} from './walkSourceMapSegments'

type MappedPosition = { line: number; column: number }

/** One scan of a sealed map over a range of original lines: the first mapped column of each line the scan found, in line order, and whether the scan read the whole map. A position it found is a position; a line it did not find is unmapped only when the scan is complete. {@link ConfiguredBrowserRun} keeps one per stop and hands it to {@link resolveArmedPlace}, {@link createBindingLineRule} and {@link findUnmappedDeclaredStop}. */
export interface MappedPositionsScan {
  positions: readonly MappedPosition[]
  complete: boolean
}

/**
 * Finds the first mapped column of each original line in a range, for the declared-line check before input, the binding rule and the hints of a binding failure; {@link createBundleVerifier} calls it only for a sealed map.
 * @param mappings - The map's VLQ `mappings` string.
 * @param selectedSourceIndex - Index of the cited original in the map's `sources`.
 * @param startLine - First one-based original line to report.
 * @param endLine - Last one-based original line to report.
 * @param isCodeAt - Tells whether the generated text at a zero-based generated line and column can run; a mapping it refuses (a kept comment) is not a position. Without it every mapping counts.
 * @returns The ordered positions, and whether the scan read the whole map before its size limits.
 * @example
 * sourceMapMappedPositions('AAAA;AACA', 0, 1, 2).positions // [{ line: 1, column: 1 }, { line: 2, column: 1 }]
 * sourceMapMappedPositions('AAAA;AACA', 0, 1, 2, (line) => line === 0).positions // [{ line: 1, column: 1 }]
 */
export function sourceMapMappedPositions(
  mappings: string,
  selectedSourceIndex: number,
  startLine: number,
  endLine: number,
  isCodeAt: (generatedLine: number, generatedColumn: number) => boolean = () =>
    true,
): { positions: MappedPosition[]; complete: boolean } {
  const columns = new Map<number, number>()
  const complete = walkSourceMapSegments(
    mappings,
    ({ generatedLine, generatedColumn, original }) => {
      const position = mappedPositionOf(original, selectedSourceIndex)
      // Mappings are hints, not proof that the debugger can bind or that the user's action reaches this line.
      if (
        position &&
        isEarlierColumnInRange(columns, position, startLine, endLine) &&
        isCodeAt(generatedLine, generatedColumn)
      )
        columns.set(position.line, position.column)
    },
  )
  return { positions: orderedPositions(columns), complete }
}

/**
 * Reads the one-based original position a segment maps to in the cited source; called by {@link sourceMapMappedPositions} for every segment.
 * @param original - The segment's zero-based original position, absent for a segment without an original.
 * @param selectedSourceIndex - Index of the cited original in the map's `sources`.
 * @returns The position, or `undefined` for a segment without an original and for one of another source.
 * @example
 * mappedPositionOf({ sourceIndex: 0, line: 1, column: 0 }, 0) // => { line: 2, column: 1 }
 * mappedPositionOf({ sourceIndex: 1, line: 1, column: 0 }, 0) // => undefined
 */
function mappedPositionOf(
  original: SourceMapSegment['original'],
  selectedSourceIndex: number,
): MappedPosition | undefined {
  if (original?.sourceIndex !== selectedSourceIndex) return undefined
  return { line: original.line + 1, column: original.column + 1 }
}

/**
 * Says whether a mapped position lies in the asked lines and before the column found for its line so far; called by {@link sourceMapMappedPositions} before it asks whether the generated text there can run.
 * @param columns - The first mapped column found so far, by one-based original line.
 * @param position - The one-based original position of a segment.
 * @param startLine - First one-based original line to report.
 * @param endLine - Last one-based original line to report.
 * @returns Whether the line is in the range and has no column yet or a later one.
 * @example
 * isEarlierColumnInRange(new Map([[1, 5]]), { line: 1, column: 3 }, 1, 2) // => true
 * isEarlierColumnInRange(new Map([[1, 5]]), { line: 3, column: 1 }, 1, 2) // => false
 */
function isEarlierColumnInRange(
  columns: ReadonlyMap<number, number>,
  position: MappedPosition,
  startLine: number,
  endLine: number,
): boolean {
  return (
    position.line >= startLine &&
    position.line <= endLine &&
    (columns.get(position.line) ?? Infinity) > position.column
  )
}

/** Orders bounded line hints for {@link sourceMapMappedPositions} before a failed run reports them. @example orderedPositions(new Map([[2, 3], [1, 1]])) // [{ line: 1, column: 1 }, { line: 2, column: 3 }] */
function orderedPositions(columns: Map<number, number>): MappedPosition[] {
  return [...columns]
    .sort(([left], [right]) => left - right)
    .map(([line, column]) => ({ line, column }))
}
