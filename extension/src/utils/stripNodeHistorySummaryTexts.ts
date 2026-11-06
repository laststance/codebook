import type { NodeHistorySummary } from '../nodeHistorySummary'
import type { NodeScriptHistorySummary } from '../nodeScriptHistoryTypes'
import type { NodeServerHistorySummary } from '../nodeServerHistoryTypes'

import { stripTerminalControls } from './stripTerminalControls'

/** Strips the controls from the capture reasons' texts of a node run summary. */
function stripReasons<Reason extends { text: string }>(
  reasons: readonly Reason[],
): Reason[] {
  return reasons.map((reason) => ({
    ...reason,
    text: stripTerminalControls(reason.text),
  }))
}

/** The words every node run summary records beside its question: the saved title and the reason. */
function stripRunSummaryTexts(
  summary: NodeServerHistorySummary | NodeScriptHistorySummary,
) {
  return {
    question: stripTerminalControls(summary.question),
    ...(summary.title ? { title: stripTerminalControls(summary.title) } : {}),
    ...(summary.reason
      ? { reason: stripTerminalControls(summary.reason) }
      : {}),
    captureMissing: stripReasons(summary.captureMissing),
  }
}

/** A server history's recorded words are its question, saved title, request line and capture reasons. */
function stripServerSummaryTexts(
  summary: NodeServerHistorySummary,
): NodeServerHistorySummary {
  return {
    ...summary,
    ...stripRunSummaryTexts(summary),
    requestLine: stripTerminalControls(summary.requestLine),
    ...(summary.requestFailureCode
      ? {
          requestFailureCode: stripTerminalControls(summary.requestFailureCode),
        }
      : {}),
    ...(summary.signInLine
      ? { signInLine: stripTerminalControls(summary.signInLine) }
      : {}),
  }
}

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
  summary: NodeScriptHistorySummary,
): NodeScriptHistorySummary
export function stripNodeHistorySummaryTexts(
  summary: NodeHistorySummary | { testFile: string; testTitles?: string[] },
): unknown {
  if ('profile' in summary && summary.profile === 'node-server')
    return stripServerSummaryTexts(summary)
  // A script history's recorded words are its question, saved title, entry file and capture reasons.
  if ('profile' in summary && summary.profile === 'node-script')
    return {
      ...summary,
      ...stripRunSummaryTexts(summary),
      entry: stripTerminalControls(summary.entry),
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
