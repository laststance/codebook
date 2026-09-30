import {
  REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES,
  REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS,
  REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT,
  SOURCE_MAP_NAMED_SEGMENT_FIELDS,
  SOURCE_MAP_SOURCE_SEGMENT_FIELDS,
  SOURCE_MAP_UNMAPPED_SEGMENT_FIELDS,
  SOURCE_MAP_VLQ_CONTINUATION_MASK,
  SOURCE_MAP_VLQ_SHIFT_BITS,
  SOURCE_MAP_VLQ_SIGN_DIVISOR,
  SOURCE_MAP_VLQ_VALUE_MASK,
} from '../constants'

type MappedPosition = { line: number; column: number }

/** Finds one mapped column per cited original line when a configured breakpoint cannot bind; {@link createBundleVerifier} calls it only for a sealed map. @example sourceMapMappedPositions('AAAA;AACA', 0, 1, 2).positions // [{ line: 1, column: 1 }, { line: 2, column: 1 }] */
export function sourceMapMappedPositions(
  mappings: string,
  selectedSourceIndex: number,
  startLine: number,
  endLine: number,
  requiredColumn?: number,
): { positions: MappedPosition[]; complete: boolean } {
  const columns = new Map<number, number>()
  let sourceIndex = 0,
    originalLine = 0,
    originalColumn = 0,
    segmentsRead = 0,
    generatedLinesRead = 1
  for (
    let cursor = 0, segmentStart = 0, generatedColumn = 0;
    cursor <= mappings.length;
    cursor++
  ) {
    // Empty delimiters consume the same bounded scan as mapped segments; no split arrays are allocated.
    if (
      cursor === REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS &&
      cursor < mappings.length
    )
      return { positions: orderedPositions(columns), complete: false }
    const delimiter = cursor === mappings.length ? undefined : mappings[cursor]
    if (delimiter !== ',' && delimiter !== ';' && cursor !== mappings.length)
      continue
    if (++segmentsRead > REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT)
      return { positions: orderedPositions(columns), complete: false }
    if (cursor > segmentStart) {
      const segment = mappings.slice(segmentStart, cursor)
      const fields = decodeSegment(segment)
      generatedColumn += fields[0]!
      if (!Number.isSafeInteger(generatedColumn) || generatedColumn < 0)
        throw new Error('Invalid generated map column')
      if (fields.length !== SOURCE_MAP_UNMAPPED_SEGMENT_FIELDS) {
        if (
          fields.length !== SOURCE_MAP_SOURCE_SEGMENT_FIELDS &&
          fields.length !== SOURCE_MAP_NAMED_SEGMENT_FIELDS
        )
          throw new Error('Invalid source map segment')
        sourceIndex += fields[1]!
        originalLine += fields[2]!
        originalColumn += fields[3]!
        if (
          ![sourceIndex, originalLine, originalColumn].every(
            Number.isSafeInteger,
          ) ||
          sourceIndex < 0 ||
          originalLine < 0 ||
          originalColumn < 0
        )
          throw new Error('Invalid original map position')
        const line = originalLine + 1,
          column = originalColumn + 1
        // Mappings are hints, not proof that the debugger can bind or that the user's action reaches this line.
        if (
          sourceIndex === selectedSourceIndex &&
          line >= startLine &&
          line <= endLine &&
          (requiredColumn === undefined || column === requiredColumn) &&
          (columns.get(line) ?? Infinity) > column
        )
          columns.set(line, column)
      }
    }
    if (delimiter === ';') {
      if (++generatedLinesRead > REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES)
        return { positions: orderedPositions(columns), complete: false }
      generatedColumn = 0
    }
    segmentStart = cursor + 1
  }
  return { positions: orderedPositions(columns), complete: true }
}

/** Decodes signed Base64 VLQ fields for {@link sourceMapMappedPositions} so map hints use exact one-based source coordinates. @example decodeSegment('AAAA') // [0, 0, 0, 0] */
function decodeSegment(segment: string): number[] {
  const values: number[] = []
  let encoded = 0,
    shift = 0
  for (const character of segment) {
    const digit =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(
        character,
      )
    if (digit < 0) throw new Error('Invalid source map digit')
    encoded +=
      (digit & SOURCE_MAP_VLQ_VALUE_MASK) * SOURCE_MAP_VLQ_SIGN_DIVISOR ** shift
    if (!Number.isSafeInteger(encoded))
      throw new Error('Oversized source map field')
    if (digit & SOURCE_MAP_VLQ_CONTINUATION_MASK) {
      shift += SOURCE_MAP_VLQ_SHIFT_BITS
      continue
    }
    values.push(
      (encoded % SOURCE_MAP_VLQ_SIGN_DIVISOR ? -1 : 1) *
        Math.floor(encoded / SOURCE_MAP_VLQ_SIGN_DIVISOR),
    )
    encoded = 0
    shift = 0
  }
  if (shift !== 0 || !values.length)
    throw new Error('Incomplete source map segment')
  return values
}

/** Orders bounded line hints for {@link sourceMapMappedPositions} before a failed run reports them. @example orderedPositions(new Map([[2, 3], [1, 1]])) // [{ line: 1, column: 1 }, { line: 2, column: 3 }] */
function orderedPositions(columns: Map<number, number>): MappedPosition[] {
  return [...columns]
    .sort(([left], [right]) => left - right)
    .map(([line, column]) => ({ line, column }))
}
