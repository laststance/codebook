import type { NodeHistorySummary } from '../nodeHistorySummary'
import type { NodeServerHistorySummary } from '../nodeServerHistoryTypes'

import { stripTerminalControls } from './stripTerminalControls'

/**
 * Removes terminal and bidirectional controls from the recorded test file and titles of a Saved studies catalog entry, so a U+202E in a test title cannot reorder the text the Study message or a notice prints about a saved test replay (F131); called by the Study workspace for each catalog entry it sends or names, and by {@link sanitizeNodeTestHistory} for an opened replay's configuration.
 * The entry's identity and every other field are untouched.
 * @param summary - A catalog entry as the history store lists it.
 * @returns The entry with its test file and titles free of controls; the input is not changed.
 * @example stripNodeHistorySummaryTexts({ testFile: 'a.test.ts', testTitles: ['x\u202Ey'] }).testTitles // => ['xy']
 */
export function stripNodeHistorySummaryTexts<
  Summary extends { testFile: string; testTitles?: string[] },
>(summary: Summary): Summary
export function stripNodeHistorySummaryTexts(
  summary: NodeServerHistorySummary,
): NodeServerHistorySummary
export function stripNodeHistorySummaryTexts(
  summary: NodeHistorySummary | { testFile: string; testTitles?: string[] },
): unknown {
  // A server history's recorded words are its question, saved title, request line and capture reasons.
  if ('profile' in summary && summary.profile === 'node-server')
    return {
      ...summary,
      question: stripTerminalControls(summary.question),
      ...(summary.title ? { title: stripTerminalControls(summary.title) } : {}),
      requestLine: stripTerminalControls(summary.requestLine),
      ...(summary.requestFailureCode
        ? {
            requestFailureCode: stripTerminalControls(
              summary.requestFailureCode,
            ),
          }
        : {}),
      ...(summary.reason
        ? { reason: stripTerminalControls(summary.reason) }
        : {}),
      captureMissing: summary.captureMissing.map((reason) => ({
        ...reason,
        text: stripTerminalControls(reason.text),
      })),
    }
  if (!('testFile' in summary)) return summary
  return {
    ...summary,
    testFile: stripTerminalControls(summary.testFile),
    ...(summary.testTitles
      ? { testTitles: summary.testTitles.map(stripTerminalControls) }
      : {}),
  }
}
