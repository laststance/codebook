import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { configuredStopFields } from './configuredStopFields'
import { configuredStops } from './configuredStops'

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
    const lineText = sources
      .find((source) => source.path === path)
      ?.text.split(/\r\n|\r|\n/)[line - 1]
    // A column one past the last character is the end of the line and still a position of it.
    if (lineText === undefined || column <= lineText.length + 1) continue
    const highestColumn = lineText.length + 1,
      field = `${configuredStopFields(configuration.version, stopIndex).source}.column`
    const length = `${path}:${line} has a length of ${lineText.length}${lineText.length === 0 ? ' (a blank line)' : ''}`
    const remedy =
      highestColumn === 1
        ? 'Declare column 1.'
        : `Declare a column from 1 to ${highestColumn}.`
    return `${field} ${column} lies past the end of its line: ${length}, so the highest column accepted is ${highestColumn}. ${remedy}`
  }
  return undefined
}
