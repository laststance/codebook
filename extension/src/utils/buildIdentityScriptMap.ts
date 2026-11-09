/** The base64 digits a source map's VLQ values are written in. */
const BASE64_DIGITS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The bits of one VLQ digit that carry value (the sixth is the continuation flag). */
const VLQ_VALUE_BITS = 5

/** The mask of the value bits of one VLQ digit. */
const VLQ_VALUE_MASK = 0b11111

/** The continuation flag of a VLQ digit. */
const VLQ_CONTINUATION_BIT = 0b100000

/**
 * Writes one signed integer as the base64 VLQ a source map's `mappings` field holds.
 * Called by {@link buildIdentityScriptMap} for each segment field.
 * @param value - The signed integer.
 * @returns The VLQ text.
 * @example encodeVlq(1) // => 'C'
 * @example encodeVlq(-1) // => 'D'
 */
function encodeVlq(value: number): string {
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1
  let text = ''
  do {
    let digit = remaining & VLQ_VALUE_MASK
    remaining >>>= VLQ_VALUE_BITS
    if (remaining > 0) digit |= VLQ_CONTINUATION_BIT
    text += BASE64_DIGITS[digit]
  } while (remaining > 0)
  return text
}

/** What {@link buildIdentityScriptMap} needs to map a script onto the file it sits in. */
export type IdentityScriptMapInput = Readonly<{
  /** The absolute path of the file the script sits in (an HTML page, or the script file itself). */
  sourcePath: string
  /** The whole file text, as the checked-out file holds it. */
  sourceText: string
  /** The script's text as the browser executes it. */
  scriptText: string
  /** The zero-based line of the file where the script's text starts (0 for a script file). */
  startLine: number
  /** The zero-based column of that line where the script's text starts (0 for a script file). */
  startColumn: number
}>

/**
 * Builds the source map that puts every non-blank character of a script back on the same place of the file it sits in.
 *
 * Why it exists: a page script has no map of its own, yet the run seals a stop through a map; the browser reports an inline script's positions in the whole page's coordinates, so the generated side of this map is the file's own coordinates and the original is the same file. Every character is mapped (not only statement starts) so a paused position maps to its exact column.
 * Called by {@link sealStaticPageScript}.
 * @param input - The file, the script and where the script starts.
 * @returns The flat version 3 map as JSON text, with the file as its one source and its text as the retained original.
 * @example
 * buildIdentityScriptMap({ sourcePath: '/p/index.html', sourceText: '<script>\na=1\n</script>', scriptText: '\na=1\n', startLine: 0, startColumn: 8 }) // => '{"version":3,…}'
 */
export function buildIdentityScriptMap(input: IdentityScriptMapInput): string {
  const lines = input.scriptText.split(/\r\n|\r|\n/)
  const lineMappings: string[] = []
  // The original line and column accumulate over the whole mapping; the generated column restarts on each line.
  let previousOriginalLine = 0
  let previousOriginalColumn = 0
  for (const [lineOffset, text] of lines.entries()) {
    const fileLine = input.startLine + lineOffset
    const firstColumn = lineOffset === 0 ? input.startColumn : 0
    let previousGeneratedColumn = 0
    const segments: string[] = []
    for (const [characterIndex, character] of [...text].entries()) {
      // Blank characters carry no position a pause can report.
      if (character === ' ' || character === '\t') continue
      const fileColumn = firstColumn + characterIndex
      segments.push(
        encodeVlq(fileColumn - previousGeneratedColumn) +
          encodeVlq(0) +
          encodeVlq(fileLine - previousOriginalLine) +
          encodeVlq(fileColumn - previousOriginalColumn),
      )
      previousGeneratedColumn = fileColumn
      previousOriginalLine = fileLine
      previousOriginalColumn = fileColumn
    }
    lineMappings.push(segments.join(','))
  }
  // Generated lines before the script's own are empty.
  const mappings = `${';'.repeat(input.startLine)}${lineMappings.join(';')}`
  return JSON.stringify({
    version: 3,
    file: '',
    sourceRoot: '',
    sources: [input.sourcePath],
    sourcesContent: [input.sourceText],
    names: [],
    // The map schema needs a non-empty field even for a script with no mappable character.
    mappings: mappings === '' ? ';' : mappings,
  })
}
