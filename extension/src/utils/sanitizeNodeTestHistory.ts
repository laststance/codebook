import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { stripOutputEntries } from './indexNodeTestOutput'
import { stripTerminalControls } from './stripTerminalControls'

/**
 * Removes terminal and bidirectional controls from every recorded text the replay's surfaces print, in one place on the host, so a U+202E in a test title, an output entry, a captured fact or the result's output tail cannot reorder a line in the Study section or the Application header while the output region shows the same text in logical order (F131); called by the Study workspace once per opened test replay, before the Study message and the Application view are projected.
 * The history's identity, sources, frames, debugger snapshots and counts are untouched, so a stop still verifies and a position still matches; the input is not changed.
 * @param history - The history as the store read it.
 * @returns A history whose output text, result output tail, fact displays and cited test file and titles are free of controls (output entries read as one stream per channel, {@link stripOutputEntries}).
 * @example sanitizeNodeTestHistory(history).entries[0] // => { type: 'output', text: 'ok\n', … } for a recorded 'o‮k\n'
 */
export function sanitizeNodeTestHistory(
  history: NodeTestHistoryIndex,
): NodeTestHistoryIndex {
  const shownOutput = stripOutputEntries(history.entries)
  const configuration = history.header.configuration
  return {
    ...history,
    header: {
      ...history.header,
      configuration: {
        ...configuration,
        testFile: stripTerminalControls(configuration.testFile),
        ...(configuration.testTitles
          ? { testTitles: configuration.testTitles.map(stripTerminalControls) }
          : {}),
      },
    },
    entries: history.entries.map((entry) => {
      if (entry.type === 'output')
        return { ...entry, text: shownOutput.get(entry.sequence)! }
      if (entry.type === 'result')
        return { ...entry, outputTail: stripTerminalControls(entry.outputTail) }
      return {
        ...entry,
        facts: entry.facts.map((fact) => ({
          ...fact,
          display: stripTerminalControls(fact.display),
        })),
      }
    }),
  }
}
