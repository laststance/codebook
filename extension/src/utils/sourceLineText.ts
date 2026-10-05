import type { ConfiguredDescriptor } from '../configuredStudySchemas'

/**
 * Reads the text of one line of a retained source, so a declared stop can be judged against the line it names; called by {@link takenStopPosition} for every declared stop.
 * Lines are split as `lineCount` and every citation check split them (CRLF, CR and LF each end one line).
 * @param sources - The selected node's retained sources.
 * @param path - Repository path of the stop's source file.
 * @param line - The line, counted from 1.
 * @returns
 * - The line's text without its line ending (an empty string for a blank line)
 * - `undefined` when the sources do not hold the file or the file has no such line
 * @example
 * sourceLineText([{ path: 'src/theme.ts', text: 'export const theme = 1\n' }], 'src/theme.ts', 1) // => 'export const theme = 1'
 * sourceLineText([{ path: 'src/theme.ts', text: 'export const theme = 1\n' }], 'src/theme.ts', 2) // => ''
 */
export function sourceLineText(
  sources: ConfiguredDescriptor['sources'],
  path: string,
  line: number,
): string | undefined {
  return sources
    .find((source) => source.path === path)
    ?.text.split(/\r\n|\r|\n/)[line - 1]
}
