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

/** Where a scan of a source map's `mappings` stands: what it has counted against its size limits, where the segment it is reading began, and the running sums the map's relative fields add up to. */
interface SourceMapScan {
  /** Segments read so far, empty ones included; bounded by {@link REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT}. */
  segmentsRead: number
  /** Generated lines begun so far; bounded by {@link REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES}. */
  generatedLinesRead: number
  /** Position in `mappings` of the first character of the segment being read. */
  segmentStart: number
  /** Zero-based generated column of the last segment of the current generated line. */
  generatedColumn: number
  /** Zero-based original position of the last mapped segment. */
  sourceIndex: number
  originalLine: number
  originalColumn: number
}

/**
 * Says whether a segment ends at a position; called by {@link scanCharacterAt} at every character.
 * @param mappings - The map's VLQ `mappings` string.
 * @param cursor - The position the scan stands at; the string's length is the position after its last character.
 * @returns `true` at a `,`, at a `;` and at the end of the string; `false` inside a segment.
 * @example
 * isSegmentEndAt('AAAA;AACA', 4) // => true
 * isSegmentEndAt('AAAA;AACA', 2) // => false
 */
function isSegmentEndAt(mappings: string, cursor: number): boolean {
  return (
    cursor === mappings.length ||
    mappings[cursor] === ',' ||
    mappings[cursor] === ';'
  )
}

/**
 * Says whether the running original position is one a map may hold; called by {@link advanceOriginal} after a segment's fields were added.
 * @param scan - The scan, with its original position advanced.
 * @returns Whether source index, line and column are safe integers and none is negative.
 * @example
 * isOriginalPosition({ ...scan, sourceIndex: 0, originalLine: -1, originalColumn: 0 }) // => false
 */
function isOriginalPosition(scan: SourceMapScan): boolean {
  return (
    [scan.sourceIndex, scan.originalLine, scan.originalColumn].every(
      Number.isSafeInteger,
    ) &&
    scan.sourceIndex >= 0 &&
    scan.originalLine >= 0 &&
    scan.originalColumn >= 0
  )
}

/**
 * Adds a mapped segment's relative fields to the scan's original position; called by {@link readSegment} for a segment that has an original.
 * @param scan - The scan; its source index, original line and original column are advanced.
 * @param fields - The segment's decoded fields.
 * @returns The original position the segment maps to, zero-based.
 * @throws When the segment has neither four nor five fields, or the position it leads to is negative or no safe integer.
 * @example
 * advanceOriginal(scan, [0, 0, 1, 0]) // => { sourceIndex: 0, line: 1, column: 0 }
 */
function advanceOriginal(
  scan: SourceMapScan,
  fields: number[],
): NonNullable<SourceMapSegment['original']> {
  if (
    fields.length !== SOURCE_MAP_SOURCE_SEGMENT_FIELDS &&
    fields.length !== SOURCE_MAP_NAMED_SEGMENT_FIELDS
  )
    throw new Error('Invalid source map segment')
  scan.sourceIndex += fields[1]!
  scan.originalLine += fields[2]!
  scan.originalColumn += fields[3]!
  if (!isOriginalPosition(scan))
    throw new Error('Invalid original map position')
  return {
    sourceIndex: scan.sourceIndex,
    line: scan.originalLine,
    column: scan.originalColumn,
  }
}

/**
 * Decodes one segment and advances the scan's running sums by it; called by {@link visitSegmentBefore} for every segment that is not empty.
 * @param scan - The scan; its generated column and, for a mapped segment, its original position are advanced.
 * @param segment - The segment's text.
 * @returns The segment at absolute zero-based coordinates, without `original` when it maps its generated code to no original.
 * @throws When the segment is malformed or names a negative position.
 * @example
 * readSegment(scan, 'AACA') // => { generatedLine: 1, generatedColumn: 0, original: { sourceIndex: 0, line: 1, column: 0 } }
 */
function readSegment(scan: SourceMapScan, segment: string): SourceMapSegment {
  const fields = decodeSegment(segment)
  scan.generatedColumn += fields[0]!
  if (!Number.isSafeInteger(scan.generatedColumn) || scan.generatedColumn < 0)
    throw new Error('Invalid generated map column')
  const generatedLine = scan.generatedLinesRead - 1
  if (fields.length === SOURCE_MAP_UNMAPPED_SEGMENT_FIELDS)
    return { generatedLine, generatedColumn: scan.generatedColumn }
  const original = advanceOriginal(scan, fields)
  return { generatedLine, generatedColumn: scan.generatedColumn, original }
}

/**
 * Counts the segment that ends at a position and hands it to the visitor unless it is empty; called by {@link endSegmentAt}.
 * @param mappings - The map's VLQ `mappings` string.
 * @param cursor - The position of the delimiter that ends the segment, or the string's length.
 * @param scan - The scan; its segment count and running sums are advanced.
 * @param visit - Called with the segment.
 * @returns `false` when the segment is one more than {@link REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT}, so it was not read; `true` otherwise.
 * @throws When the segment is malformed or names a negative position.
 * @example
 * visitSegmentBefore('AAAA;AACA', 4, scan, visit) // => true, after visit({ generatedLine: 0, generatedColumn: 0, original: { sourceIndex: 0, line: 0, column: 0 } })
 */
function visitSegmentBefore(
  mappings: string,
  cursor: number,
  scan: SourceMapScan,
  visit: (segment: SourceMapSegment) => void,
): boolean {
  if (++scan.segmentsRead > REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT)
    return false
  if (cursor > scan.segmentStart)
    visit(readSegment(scan, mappings.slice(scan.segmentStart, cursor)))
  return true
}

/**
 * Ends the segment at a delimiter or at the end of the map: reads it, begins the next generated line after a `;`, and moves the scan to the next segment; called by {@link scanCharacterAt} wherever a segment ends.
 * @param mappings - The map's VLQ `mappings` string.
 * @param cursor - The position of the delimiter, or the string's length.
 * @param scan - The scan, which is advanced.
 * @param visit - Called with the segment unless it is empty.
 * @returns `false` when the scan stops at its segment limit or its generated-line limit; `true` when it goes on.
 * @throws When the segment is malformed or names a negative position.
 * @example
 * endSegmentAt('AAAA;AACA', 4, scan, visit) // => true; the scan stands at generated line 1, column 0
 */
function endSegmentAt(
  mappings: string,
  cursor: number,
  scan: SourceMapScan,
  visit: (segment: SourceMapSegment) => void,
): boolean {
  if (!visitSegmentBefore(mappings, cursor, scan, visit)) return false
  if (mappings[cursor] === ';') {
    if (
      ++scan.generatedLinesRead > REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES
    )
      return false
    scan.generatedColumn = 0
  }
  scan.segmentStart = cursor + 1
  return true
}

/**
 * Takes the scan one character further; called by {@link walkSourceMapSegments} for every position up to the end of the map.
 * @param mappings - The map's VLQ `mappings` string.
 * @param cursor - The position the scan stands at; the string's length is the position after its last character.
 * @param scan - The scan, which is advanced where a segment ends.
 * @param visit - Called with a segment that ends here, unless it is empty.
 * @returns `false` when the scan stops at a size limit ({@link REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS} characters with more of the map left, the segment limit or the generated-line limit); `true` when it goes on.
 * @throws When a segment that ends here is malformed or names a negative position.
 * @example
 * scanCharacterAt('AAAA;AACA', 2, scan, visit) // => true: inside a segment nothing happens
 */
function scanCharacterAt(
  mappings: string,
  cursor: number,
  scan: SourceMapScan,
  visit: (segment: SourceMapSegment) => void,
): boolean {
  // Empty delimiters consume the same bounded scan as mapped segments; no split arrays are allocated.
  if (
    cursor === REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS &&
    cursor < mappings.length
  )
    return false
  if (!isSegmentEndAt(mappings, cursor)) return true
  return endSegmentAt(mappings, cursor, scan, visit)
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
  const scan: SourceMapScan = {
    segmentsRead: 0,
    generatedLinesRead: 1,
    segmentStart: 0,
    generatedColumn: 0,
    sourceIndex: 0,
    originalLine: 0,
    originalColumn: 0,
  }
  for (let cursor = 0; cursor <= mappings.length; cursor++)
    if (!scanCharacterAt(mappings, cursor, scan, visit)) return false
  return true
}

/**
 * Reads the value of one Base64 character of a VLQ field; called by {@link decodeSegment} for every character of a segment.
 * @param character - One character of the segment.
 * @returns The digit, 0 to 63.
 * @throws When the character is no Base64 digit.
 * @example
 * vlqDigitOf('C') // => 2
 */
function vlqDigitOf(character: string): number {
  const digit =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(
      character,
    )
  if (digit < 0) throw new Error('Invalid source map digit')
  return digit
}

/**
 * Turns the bits of a finished VLQ field into its signed value; called by {@link decodeSegment} at the last digit of a field.
 * @param encoded - The field's bits, whose lowest bit is the sign.
 * @returns The value, negative when the sign bit is set.
 * @example
 * signedVlqValue(2) // => 1
 * signedVlqValue(3) // => -1
 */
function signedVlqValue(encoded: number): number {
  return (
    (encoded % SOURCE_MAP_VLQ_SIGN_DIVISOR ? -1 : 1) *
    Math.floor(encoded / SOURCE_MAP_VLQ_SIGN_DIVISOR)
  )
}

/**
 * Refuses a segment that ends inside a field or holds no field; called by {@link decodeSegment} after the last character.
 * @param shift - The shift of the field being read; 0 when the last field was finished.
 * @param fieldCount - How many fields the segment gave.
 * @throws When a field is unfinished or the segment has no field.
 * @example
 * assertCompleteSegment(0, 4) // returns
 */
function assertCompleteSegment(shift: number, fieldCount: number): void {
  if (shift !== 0 || !fieldCount)
    throw new Error('Incomplete source map segment')
}

/**
 * Decodes signed Base64 VLQ fields for {@link readSegment} so map readers use exact source coordinates.
 * @param segment - One segment of a map's `mappings`, without its delimiter.
 * @returns The segment's fields as signed numbers, in the order the map holds them.
 * @throws When a character is no Base64 digit, a field is larger than a safe integer, or the segment ends inside a field or is empty.
 * @example
 * decodeSegment('AAAA') // => [0, 0, 0, 0]
 */
function decodeSegment(segment: string): number[] {
  const values: number[] = []
  let encoded = 0,
    shift = 0
  for (const character of segment) {
    const digit = vlqDigitOf(character)
    encoded +=
      (digit & SOURCE_MAP_VLQ_VALUE_MASK) * SOURCE_MAP_VLQ_SIGN_DIVISOR ** shift
    if (!Number.isSafeInteger(encoded))
      throw new Error('Oversized source map field')
    if (digit & SOURCE_MAP_VLQ_CONTINUATION_MASK) {
      shift += SOURCE_MAP_VLQ_SHIFT_BITS
      continue
    }
    values.push(signedVlqValue(encoded))
    encoded = 0
    shift = 0
  }
  assertCompleteSegment(shift, values.length)
  return values
}
