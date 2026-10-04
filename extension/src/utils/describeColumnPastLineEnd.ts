import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { configuredStopFields } from './configuredStopFields'
import { configuredStops } from './configuredStops'

/**
 * Reads the text of a declared line from the selected node's retained sources; called by {@link describeColumnPastLineEnd} for each declared stop.
 * @param sources - The selected node's retained sources.
 * @param path - Repository path of the stop's source file.
 * @param line - The stop's declared line, counted from 1.
 * @returns
 * - The line's text without its line ending
 * - `undefined` when the sources do not hold the file or the file has no such line
 * @example
 * declaredLineText([{ path: 'src/theme.ts', text: 'export const theme = 1\n' }], 'src/theme.ts', 1) // => 'export const theme = 1'
 */
function declaredLineText(
  sources: ConfiguredDescriptor['sources'],
  path: string,
  line: number,
): string | undefined {
  return sources
    .find((source) => source.path === path)
    ?.text.split(/\r\n|\r|\n/)[line - 1]
}

/**
 * Words the sentence for one declared column that lies past the end of its line; called by {@link describeColumnPastLineEnd} for the first such stop.
 * @param field - The configuration field that holds the column.
 * @param position - The stop's declared path, line and column.
 * @param lineText - The text of the declared line.
 * @returns One sentence naming the field, the line's length (a blank line is called one), the highest column accepted and what to declare.
 * @example
 * describeColumnPastEndOf('configuration.source.column', { path: 'src/theme.ts', line: 1, column: 100 }, 'export const theme = 1;;;')
 * // => 'configuration.source.column 100 lies past the end of its line: src/theme.ts:1 has a length of 25, so the highest column accepted is 26. Declare a column from 1 to 26.'
 */
function describeColumnPastEndOf(
  field: string,
  position: { path: string; line: number; column: number },
  lineText: string,
): string {
  const { path, line, column } = position
  const highestColumn = lineText.length + 1
  const length = `${path}:${line} has a length of ${lineText.length}${lineText.length === 0 ? ' (a blank line)' : ''}`
  const remedy =
    highestColumn === 1
      ? 'Declare column 1.'
      : `Declare a column from 1 to ${highestColumn}.`
  return `${field} ${column} lies past the end of its line: ${length}, so the highest column accepted is ${highestColumn}. ${remedy}`
}

/**
 * Names the first declared stop whose column lies past the end of its line, so an agent can correct the column instead of guessing which part of the position was refused.
 * Called by {@link prepareRepositoryStudy} when {@link assertConfiguredDescriptor} refuses a start and {@link describeCitationMismatch} found every stop inside its selected citation.
 * @param configuration - The start's configuration; its stops are expanded by {@link configuredStops}.
 * @param sources - The selected node's retained sources, whose text the declared lines are read from.
 * @returns
 * - A stop whose column is greater than its line's length plus one: one sentence naming the column's field, the line's length and the highest column accepted (1 on a line without characters), and what to declare
 * - Every stop within its line, or on a line the sources do not hold: undefined (the refusal has another cause)
 * @example
 * describeColumnPastLineEnd(configuration, sources)
 * // => 'configuration.source.column 100 lies past the end of its line: src/theme.ts:1 has a length of 25, so the highest column accepted is 26. Declare a column from 1 to 26.'
 */
export function describeColumnPastLineEnd(
  configuration: RetainedRepositoryConfiguration,
  sources: ConfiguredDescriptor['sources'],
): string | undefined {
  for (const [stopIndex, stop] of configuredStops(configuration).entries()) {
    const { path, line, column } = stop.source
    const lineText = declaredLineText(sources, path, line)
    // A column one past the last character is the end of the line and still a position of it.
    if (lineText === undefined || column <= lineText.length + 1) continue
    return describeColumnPastEndOf(
      `${configuredStopFields(configuration.version, stopIndex).source}.column`,
      stop.source,
      lineText,
    )
  }
  return undefined
}
