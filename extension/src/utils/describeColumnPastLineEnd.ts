import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { configuredStopFields } from './configuredStopFields'
import { configuredStops } from './configuredStops'
import { sourceLineText } from './sourceLineText'
import { takenStopPosition } from './takenStopPosition'

/**
 * Words the sentence for one declared column that lies past the end of its line; called by {@link describeColumnPastLineEnd} for the first such stop, whose line always has characters (a column on a blank line is taken at the line's start, {@link takenStopPosition}).
 * @param field - The configuration field that holds the column.
 * @param position - The stop's declared path, line and column.
 * @param lineText - The text of the declared line.
 * @returns One sentence naming the field, the line's length, the highest column accepted and what to declare.
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
  return `${field} ${column} lies past the end of its line: ${path}:${line} has a length of ${lineText.length}, so the highest column accepted is ${highestColumn}. Declare a column from 1 to ${highestColumn}.`
}

/**
 * Names the first declared stop whose column lies past the end of its line, so an agent can correct the column instead of guessing which part of the position was refused.
 * Called by {@link prepareRepositoryStudy} when {@link assertConfiguredDescriptor} refuses a start and {@link describeCitationMismatch} found every stop inside its selected citation.
 * @param configuration - The start's configuration; its stops are expanded by {@link configuredStops}.
 * @param sources - The selected node's retained sources, whose text the declared lines are read from.
 * @returns
 * - A stop on a line with characters whose column is greater than the line's length plus one: one sentence naming the column's field, the line's length and the highest column accepted, and what to declare
 * - Every stop within its line, on a blank line (any column there is taken at the line's start) or on a line the sources do not hold: undefined (the refusal has another cause)
 * @example
 * describeColumnPastLineEnd(configuration, sources)
 * // => 'configuration.source.column 100 lies past the end of its line: src/theme.ts:1 has a length of 25, so the highest column accepted is 26. Declare a column from 1 to 26.'
 */
export function describeColumnPastLineEnd(
  configuration: RetainedRepositoryConfiguration,
  sources: ConfiguredDescriptor['sources'],
): string | undefined {
  for (const [stopIndex, stop] of configuredStops(configuration).entries()) {
    const { path, line, column } = takenStopPosition(stop.source, sources)
    const lineText = sourceLineText(sources, path, line)
    // A column one past the last character is the end of the line and still a position of it; a blank line's stop is taken at column 1.
    if (lineText === undefined || column <= lineText.length + 1) continue
    return describeColumnPastEndOf(
      `${configuredStopFields(configuration.version, stopIndex).source}.column`,
      stop.source,
      lineText,
    )
  }
  return undefined
}
