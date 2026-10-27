const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** One decoded mapping segment of a source map: where generated code at `column` came from. */
type MappingSegment = {
  column: number
  originalLine: number
  originalColumn: number
}

/** Decodes the base64 VLQ numbers of one source-map segment. */
function decodeSegment(segment: string): number[] {
  const numbers: number[] = []
  let shift = 0
  let value = 0
  for (const character of segment) {
    const digit = BASE64.indexOf(character)
    value += (digit & 31) << shift
    // A set continuation bit means the number goes on in the next character.
    if (digit & 32) {
      shift += 5
      continue
    }
    numbers.push(value & 1 ? -(value >> 1) : value >> 1)
    value = 0
    shift = 0
  }
  return numbers
}

/** Decodes the `mappings` of a source map into segments per generated line (single-source maps, as tsx emits). */
function decodeMappings(mappings: string): MappingSegment[][] {
  let originalLine = 0
  let originalColumn = 0
  return mappings.split(';').map((line) => {
    let column = 0
    const segments: MappingSegment[] = []
    for (const text of line.split(',')) {
      if (!text) continue
      const [columnDelta = 0, , lineDelta, columnDeltaOriginal] =
        decodeSegment(text)
      column += columnDelta
      // One-field segments carry no original position.
      if (lineDelta === undefined || columnDeltaOriginal === undefined) continue
      originalLine += lineDelta
      originalColumn += columnDeltaOriginal
      segments.push({ column, originalLine, originalColumn })
    }
    return segments
  })
}

/**
 * Reads an inline (`data:`) source map out of the URL V8 reports for a script.
 * @param sourceMapUrl - The `sourceMapURL` of a CDP `scriptParsed` event or instrumentation pause.
 * @returns The map's `mappings`, or undefined when the URL is absent or not an inline map.
 * @example inlineMappings('data:application/json;base64,eyJ...') // => 'AAAA;...'
 */
function inlineMappings(sourceMapUrl: string | undefined): string | undefined {
  if (!sourceMapUrl?.startsWith('data:')) return undefined
  const comma = sourceMapUrl.indexOf(',')
  const data = sourceMapUrl.slice(comma + 1)
  const json = sourceMapUrl.slice(5, comma).includes('base64')
    ? Buffer.from(data, 'base64').toString('utf8')
    : decodeURIComponent(data)
  const parsed: unknown = JSON.parse(json)
  const mappings =
    parsed && typeof parsed === 'object' && Reflect.get(parsed, 'mappings')
  return typeof mappings === 'string' ? mappings : undefined
}

/**
 * Finds where a TypeScript position is in the JavaScript a loader such as tsx generated, so a test debugger can set a breakpoint by script id.
 * The generated place is the first mapping of the original line at or after the original column, as the Part A spike bound its stops.
 * Called by {@link createCdpNodeServerDebugger} when a script with an inline source map is parsed or about to run.
 * @param sourceMapUrl - The script's inline `sourceMapURL`.
 * @param originalLine - 0-based line in the TypeScript file.
 * @param originalColumn - 0-based column in the TypeScript file.
 * @returns The 0-based generated line and column, or undefined without an inline map or a mapping on that line.
 * @example generatedPositionOfOriginal(url, 53, 31) // => { line: 0, column: 812 }
 */
export function generatedPositionOfOriginal(
  sourceMapUrl: string | undefined,
  originalLine: number,
  originalColumn: number,
): { line: number; column: number } | undefined {
  const mappings = inlineMappings(sourceMapUrl)
  if (mappings === undefined) return undefined
  let best: { line: number; column: number; originalColumn: number } | undefined
  decodeMappings(mappings).forEach((segments, line) => {
    for (const segment of segments) {
      if (
        segment.originalLine !== originalLine ||
        segment.originalColumn < originalColumn
      )
        continue
      // Prefer the smallest original column, then the earliest generated place.
      if (!best || segment.originalColumn < best.originalColumn)
        best = {
          line,
          column: segment.column,
          originalColumn: segment.originalColumn,
        }
    }
  })
  return best && { line: best.line, column: best.column }
}
