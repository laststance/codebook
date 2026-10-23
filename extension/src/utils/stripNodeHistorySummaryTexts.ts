import { stripTerminalControls } from './stripTerminalControls'

/**
 * Removes terminal and bidirectional controls from the recorded test file and titles of a Saved studies catalog entry, so a U+202E in a test title cannot reorder the text the Study message or a notice prints about a saved test replay (F131); called by the Study workspace for each catalog entry it sends or names, and by {@link sanitizeNodeTestHistory} for an opened replay's configuration.
 * The entry's identity and every other field are untouched.
 * @param summary - A catalog entry as the history store lists it.
 * @returns The entry with its test file and titles free of controls; the input is not changed.
 * @example stripNodeHistorySummaryTexts({ testFile: 'a.test.ts', testTitles: ['x‮y'] }).testTitles // => ['xy']
 */
export function stripNodeHistorySummaryTexts<
  Summary extends { testFile: string; testTitles?: string[] },
>(summary: Summary): Summary {
  return {
    ...summary,
    testFile: stripTerminalControls(summary.testFile),
    ...(summary.testTitles
      ? { testTitles: summary.testTitles.map(stripTerminalControls) }
      : {}),
  }
}
