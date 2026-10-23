import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import {
  accumulateNodeTestOutput,
  type NodeTestOutputTail,
  type NodeTestOutputViewLine,
} from './accumulateNodeTestOutput'
import {
  describeNodeTestReplay,
  NODE_TEST_REPLAY_TEXT,
} from './describeNodeTestReplay'
import { describeNodeTestResult } from './describeNodeTestResult'
import type { NodeTestOutputIndex } from './indexNodeTestOutput'

/**
 * What the Application pane shows of a test replay at one moment (EN14's narrow view model): sent once with the document and then, for each later event, as an in-place update that a newer `generation` supersedes.
 * Every field is text; the document renders each as text, never as markup.
 */
export type NodeTestApplicationView = {
  generation: number
  /** Header line 1: `Recorded test output · <t> s`, or `Recorded test output` alone without a selected event (loading, no entries). */
  time: string
  /** Header line 2: the cited test, shown in at most two lines with this whole text in its tooltip. */
  test: string
  /** The pane's accessible name. */
  name: string
  /** The output region's accessible name, `Recorded test output up to <t> s`. */
  region?: string
  /** The kept end of the output up to the event ({@link accumulateNodeTestOutput}). */
  lines: NodeTestOutputViewLine[]
  /** One muted line for each part left out: the cut and the Node inspector lines. */
  cut?: string
  inspector?: string
  /** The line that stands for the output when there is none to show: loading, nothing yet or no entries. */
  placeholder?: string
  /** The last line: the verdict at the result, or the ended-early line at a last event that is no result. */
  end?: string
}

/** The event the learner selected in a test replay. */
type SelectedEvent = NodeTestHistoryIndex['entries'][number]

/**
 * Projects what the Application pane shows of a test replay at the selected moment, from every entry of the history (not the Study pane's page) and its output read once; called by the Study workspace for each Study message while a test replay is selected.
 * @param history - The selected history, all its entries, and its status: a history still recording has no early end yet.
 * @param index - Its output read once ({@link indexNodeTestOutput}).
 * @param selected - The selected event, absent before one is selected.
 * @param generation - The Application view's generation, which changes only when the shown moment (the history, its entry count, the selected event or the opening state) does, so a document ignores an update older than the one it shows.
 * @param loading - Whether the replay is still opening.
 * @returns The view.
 * @example
 * projectNodeTestApplication(history, indexNodeTestOutput(history.entries), history.entries[0], 1, false).time // => 'Recorded test output · 0.12 s'
 */
export function projectNodeTestApplication(
  history: Pick<NodeTestHistoryIndex, 'header' | 'entries' | 'status'>,
  index: NodeTestOutputIndex,
  selected: SelectedEvent | undefined,
  generation: number,
  loading: boolean,
): NodeTestApplicationView {
  const configuration = history.header.configuration
  const test = {
    testFile: configuration.testFile,
    ...(configuration.testTitles
      ? { testTitles: configuration.testTitles }
      : {}),
  }
  const testLine = describeNodeTestReplay({ kind: 'application-test', test })
  // A history without entries has no time to name; neither has one still opening or one without a selected event: its header line 1 names the surface alone (F116).
  if (loading || !history.entries.length || !selected)
    return {
      generation,
      time: describeNodeTestReplay({ kind: 'application-time' }),
      test: testLine,
      name: describeNodeTestReplay({ kind: 'application-name', test }),
      lines: [],
      placeholder: loading
        ? NODE_TEST_REPLAY_TEXT.loading
        : history.entries.length
          ? NODE_TEST_REPLAY_TEXT.nothingYet
          : NODE_TEST_REPLAY_TEXT.noEntries,
    }
  const tail = accumulateNodeTestOutput(index, selected.sequence)
  const end = outputEnd(history, selected)
  return {
    generation,
    time: describeNodeTestReplay({
      kind: 'application-time',
      elapsedMs: selected.elapsedMs,
    }),
    test: testLine,
    name: describeNodeTestReplay({
      kind: 'application-name',
      test,
      elapsedMs: selected.elapsedMs,
    }),
    region: describeNodeTestReplay({
      kind: 'application-region',
      elapsedMs: selected.elapsedMs,
    }),
    lines: tail.lines,
    ...leftOutLines(tail),
    ...(tail.hasOutput
      ? {}
      : { placeholder: NODE_TEST_REPLAY_TEXT.nothingYet }),
    ...(end === undefined ? {} : { end }),
  }
}

/**
 * Words the muted lines for what the kept output leaves out: the earlier characters cut and the Node inspector lines folded away; called by {@link projectNodeTestApplication}.
 * @param tail - The kept output at the selected event.
 * @returns `cut` and `inspector`, each only when something was left out.
 * @example leftOutLines({ omittedCharacters: 120, startsMidLine: false, inspectorLines: 0, … }) // => { cut: '… 120 earlier characters not shown' }
 */
function leftOutLines(
  tail: NodeTestOutputTail,
): Pick<NodeTestApplicationView, 'cut' | 'inspector'> {
  return {
    ...(tail.omittedCharacters > 0
      ? {
          cut: describeNodeTestReplay({
            kind: 'application-cut',
            characters: tail.omittedCharacters,
            startsMidLine: tail.startsMidLine,
          }),
        }
      : {}),
    ...(tail.inspectorLines > 0
      ? {
          inspector: describeNodeTestReplay({
            kind: 'application-inspector',
            lines: tail.inspectorLines,
          }),
        }
      : {}),
  }
}

/**
 * Gives the line that ends the shown output: the verdict at the result, the ended-early line at a last event that is no result (DS2, DS7); called by {@link projectNodeTestApplication}.
 * A history this window is still recording has not ended: its last event so far gets no ended-early line.
 * @param history - The history's events in sequence order and its status.
 * @param selected - The selected event.
 * @returns The line, or `undefined` at any other event.
 * @example outputEnd(history, result) // => 'Test passed · exit code 0'
 */
function outputEnd(
  history: Pick<NodeTestHistoryIndex, 'entries' | 'status'>,
  selected: SelectedEvent,
): string | undefined {
  if (selected.type === 'result') return describeNodeTestResult(selected)
  const last = history.entries.at(-1)
  return history.status !== 'recording' &&
    last?.sequence === selected.sequence &&
    last.type !== 'result'
    ? NODE_TEST_REPLAY_TEXT.endedEarly
    : undefined
}
