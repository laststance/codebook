/**
 * Splits a source file into its lines as an editor numbers them, without the empty line a final line break leaves.
 * Called by {@link resolveChromeExtensionRun} to check a stop's 1-based line and read the stop's own line.
 * @param source - The file's text.
 * @returns The lines without their line breaks; an empty file has none.
 * @example
 * splitSourceLines('a\nb\n') // => ['a', 'b']
 * splitSourceLines('a\r\nb') // => ['a', 'b']
 */
export function splitSourceLines(source: string): string[] {
  const lines = source.split(/\r\n|\n|\r/)
  // A final line break ends the last line; it does not start another.
  if (lines.at(-1) === '') lines.pop()
  return lines
}
