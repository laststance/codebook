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

/** One decoded segment of a source map's `mappings`: a generated position and, unless the segment has no original, the original position it maps to. All coordinates are zero-based, as the map holds them. */
export interface SourceMapSegment {
  generatedLine: number
  generatedColumn: number
  /** Absent for a segment that maps its generated code to no original. */
  original?: { sourceIndex: number; line: number; column: number }
}

/**
 * Reads a source map's VLQ `mappings` segment by segment within the scan's size limits, so every reader of a sealed map decodes it the same way: {@link sourceMapMappedPositions} collects the mapped columns of original lines and {@link sourceMapGeneratedRange} the generated range of one original line.
 * @param mappings - The map's VLQ `mappings` string.
 * @param visit - Called for every segment, in the order of the generated code.
 * @returns `true` when the whole map was read; `false` when the scan stopped at a size limit, so what `visit` saw proves nothing about the rest.
 * @throws When a segment is malformed or names a negative position.
 * @example
 * walkSourceMapSegments('AAAA;AACA', (segment) => segments.push(segment)) // => true
 * // segments: [{ generatedLine: 0, generatedColumn: 0, original: { sourceIndex: 0, line: 0, column: 0 } }, { generatedLine: 1, generatedColumn: 0, original: { sourceIndex: 0, line: 1, column: 0 } }]
 */
export function walkSourceMapSegments(
  mappings: string,
  visit: (segment: SourceMapSegment) => void,
): boolean {
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
      return false
    const delimiter = cursor === mappings.length ? undefined : mappings[cursor]
    if (delimiter !== ',' && delimiter !== ';' && cursor !== mappings.length)
      continue
    if (++segmentsRead > REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT) return false
    if (cursor > segmentStart) {
      const segment = mappings.slice(segmentStart, cursor)
      const fields = decodeSegment(segment)
      generatedColumn += fields[0]!
      if (!Number.isSafeInteger(generatedColumn) || generatedColumn < 0)
        throw new Error('Invalid generated map column')
      const generatedLine = generatedLinesRead - 1
      if (fields.length === SOURCE_MAP_UNMAPPED_SEGMENT_FIELDS)
        visit({ generatedLine, generatedColumn })
      else {
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
        visit({
          generatedLine,
          generatedColumn,
          original: { sourceIndex, line: originalLine, column: originalColumn },
        })
      }
    }
    if (delimiter === ';') {
      if (++generatedLinesRead > REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES)
        return false
      generatedColumn = 0
    }
    segmentStart = cursor + 1
  }
  return true
}

/** Decodes signed Base64 VLQ fields for {@link walkSourceMapSegments} so map readers use exact source coordinates. @example decodeSegment('AAAA') // [0, 0, 0, 0] */
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
