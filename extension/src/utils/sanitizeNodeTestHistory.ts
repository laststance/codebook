import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { stripOutputEntries } from './indexNodeTestOutput'
import { maskFactString } from './maskFactString'
import { maskSavedOutputEntries } from './maskSavedOutputEntries'
import { stripNodeHistorySummaryTexts } from './stripNodeHistorySummaryTexts'
import { stripTerminalControls } from './stripTerminalControls'

/**
 * Removes terminal and bidirectional controls from every recorded text the replay's surfaces print, in one place on the host, so a U+202E in a test title, an output entry, a captured fact or the result's output tail cannot reorder a line in the Study section or the Application header while the output region shows the same text in logical order (F131); called by the Study workspace once per opened test replay, before the Study message and the Application view are projected.
 * A stop's source path is stripped for display only: its hash, line and column, the debugger snapshots and the counts are untouched, and the host verifies a stop against the stored history, not this one; the input is not changed.
 * @param history - The history as the store read it.
 * @returns A history whose output text, result output tail, stop source paths, frame names, fact paths and displays, and the cited test file and titles are free of controls, and whose fact displays carry no Cookie, Authorization or secret-query value ({@link maskFactString}) (output entries read as one stream per channel, {@link stripOutputEntries}); the output and the output tail, stripped first, are masked again like the live output ({@link maskSavedOutputEntries}), so a replay saved before the shape rules prints no Cookie line, Authorization value or `rawHeaders` list its test logged.
 * @example sanitizeNodeTestHistory(history).entries[0] // => { type: 'output', text: 'ok\n', … } for a recorded 'o\u202Ek\n'
 */
export function sanitizeNodeTestHistory(
  history: NodeTestHistoryIndex,
): NodeTestHistoryIndex {
  const shownOutput = stripOutputEntries(history.entries)
  // The mask reads the text a learner would see, so a control inside a Cookie line cannot hide it.
  const shownEntries = maskSavedOutputEntries(
    history.entries.map((entry) => {
      if (entry.type === 'output')
        return { ...entry, text: shownOutput.get(entry.sequence)! }
      if (entry.type === 'result')
        return { ...entry, outputTail: stripTerminalControls(entry.outputTail) }
      return entry
    }),
  )
  return {
    ...history,
    header: {
      ...history.header,
      // The cited test file and titles are stripped as a Saved studies entry's are, by one rule.
      configuration: stripNodeHistorySummaryTexts(history.header.configuration),
    },
    entries: shownEntries.map((entry) => {
      // Output and results were stripped and masked above.
      if (entry.type !== 'stop') return entry
      // Every text of a stop that the Study section's event rows print is stripped (F287); the hash, line and column stay.
      return {
        ...entry,
        source: {
          ...entry.source,
          path: stripTerminalControls(entry.source.path),
        },
        frame: {
          ...entry.frame,
          name: stripTerminalControls(entry.frame.name),
        },
        facts: entry.facts.map((fact) => ({
          ...fact,
          path: stripTerminalControls(fact.path),
          // A display saved before the shape rules is masked again here, as every serving path masks it (Cycle 0073 task 0).
          display: maskFactString(stripTerminalControls(fact.display)),
        })),
      }
    }),
  }
}
