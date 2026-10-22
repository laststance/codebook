import type { NodeTestHistorySummary } from '../nodeTestHistoryStore'

import { formatEventSeconds } from './formatEventSeconds'

/**
 * The fixed words of a test replay's surfaces, the String catalog of plan version 7 (DS18); the Study pane receives them through {@link STUDY_UI_OPTIONS}, as its client code imports nothing, and the Application pane through {@link projectNodeTestApplication} and {@link testOutputHtml}.
 * Words that hold a value are worded by {@link describeNodeTestReplay}.
 */
export const NODE_TEST_REPLAY_TEXT = {
  /** Starts a line the test wrote to standard error; a color never says it alone. */
  stderrMark: '[stderr] ',
  loading: 'Loading recorded test output…',
  nothingYet: 'No test output recorded up to this moment.',
  noEntries: 'No test output recorded.',
  endedEarly: 'Recording ended before the test result.',
  jumpToLatest: 'Jump to latest',
  applicationFooter:
    'Historical test output. Reading it does not rerun the target.',
  heading: 'Test replay',
  noStepForStop: 'No saved explanation for this stop.',
  noStepForResult: 'No saved explanation for the result.',
  notRecorded: 'Source and debugger not recorded at this moment.',
  unverifiedStop: 'Recorded source unavailable for this stop.',
  outputPointer: 'Output up to this moment is in the Application pane.',
  applicationClosed: 'The Application pane is closed.',
  showRecordedOutput: 'Show recorded output',
  noMaterial: 'No learning summary was saved for this test replay.',
  sameMoment: 'Same recorded moment',
  previousStop: 'Previous stop',
  nextStop: 'Next stop',
  previousEvent: 'Previous event',
  nextEvent: 'Next event',
  play: 'Play',
  pause: 'Pause',
  stepDetails: 'Step details',
  /** The slider's legend: a test journal records when a stop paused, not when the run resumed. */
  timelineLegend:
    'Ticks mark recorded stops; source and debugger are not recorded between them.',
  noSelection: 'Select an event to move through the recorded test history.',
  chooseReplay:
    'Choose a test replay from Saved studies to step through its output and debugger stops.',
  noReplay: 'No test replay has been saved in this workspace.',
  noLinkedEvent: 'No recorded event is linked to this step.',
  eventOutput: 'Output',
  eventStop: 'Stop',
  eventResult: 'Result',
} as const

/** What a test replay shows the learner outside its Save, keyed by surface and value (the String catalog of plan version 7). */
export type NodeTestReplayMessage =
  | {
      kind: 'saved-row'
      summary: Pick<
        NodeTestHistorySummary,
        | 'status'
        | 'verification'
        | 'verdict'
        | 'stopCount'
        | 'explainedStopCount'
      >
    }
  | {
      kind: 'study-status'
      summary: Omit<NodeTestReplayMessageSummary, 'verification'>
    }
  | { kind: 'application-time'; elapsedMs: number }
  | { kind: 'application-test'; test: NodeTestReplayTestName }
  | {
      kind: 'application-name'
      test: NodeTestReplayTestName
      elapsedMs?: number
    }
  | { kind: 'application-region'; elapsedMs: number }
  | { kind: 'application-cut'; characters: number; startsMidLine: boolean }
  | { kind: 'application-inspector'; lines: number }
  | {
      kind: 'position'
      event:
        | { type: 'stop'; index: number; stopCount: number }
        | { type: 'output' }
        | { type: 'result'; verdict: string }
      elapsedMs: number
    }
  | {
      kind: 'step-action'
      event: { type: 'stop'; index: number } | { type: 'output' | 'result' }
      elapsedMs: number
    }
  | { kind: 'events'; count: number }
  | {
      kind: 'capture-reason'
      status: 'partial' | 'interrupted'
      reason: string
    }

/** The parts of a history's summary its Study status line names. */
type NodeTestReplayMessageSummary = Pick<
  NodeTestHistorySummary,
  'status' | 'verification' | 'verdict' | 'stopCount' | 'explainedStopCount'
>

/** The cited test: its file and, in a history written since `testTitles`, the title path; a retired history named its test otherwise and shows its file alone. */
export type NodeTestReplayTestName = {
  testFile: string
  testTitles?: readonly string[]
}

/** The capture word of a sealed or interrupted history. */
const CAPTURE_WORDS = {
  complete: 'complete',
  partial: 'partial',
  interrupted: 'interrupted',
} as const

/**
 * Words what a test replay shows the learner outside its Save, so Saved studies, the Study pane and the Application pane read as the String catalog writes them; called by the Study workspace for each Saved studies row, by {@link projectNodeTestSection} for the Study pane's test replay section, and by {@link projectNodeTestApplication} for the Application pane.
 * `<t>` is the event's time since the run started, paused time included, in seconds with two decimals.
 * @param message - The surface, and the value it shows.
 * @returns The words.
 * @example
 * describeNodeTestReplay({ kind: 'saved-row', summary: { status: 'complete', verification: 'verified', verdict: 'Test passed · exit code 0', stopCount: 2, explainedStopCount: 1 } })
 * // => 'Test replay · Test passed · exit code 0 · capture complete · 1 of 2 stops explained'
 * describeNodeTestReplay({ kind: 'position', event: { type: 'stop', index: 0, stopCount: 2 }, elapsedMs: 420 })
 * // => 'Stop 1 of 2 · 0.42 s'
 */
export function describeNodeTestReplay(message: NodeTestReplayMessage): string {
  switch (message.kind) {
    case 'saved-row':
      return message.summary.verification === 'unavailable'
        ? 'Test replay · unavailable'
        : message.summary.status === 'recording'
          ? 'Test replay · recording'
          : `Test replay · ${studyStatus({ ...message.summary, status: message.summary.status })}`
    case 'study-status':
      return message.summary.status === 'recording'
        ? 'Test replay · recording'
        : studyStatus({ ...message.summary, status: message.summary.status })
    case 'position':
      return positionWords(message.event, message.elapsedMs)
    case 'step-action':
      return message.event.type === 'stop'
        ? `Inspect stop ${message.event.index + 1} · ${formatEventSeconds(message.elapsedMs)} s`
        : `Inspect ${message.event.type} · ${formatEventSeconds(message.elapsedMs)} s`
    case 'events':
      return `Events (${message.count})`
    case 'capture-reason':
      return `Capture ${CAPTURE_WORDS[message.status]}: ${message.reason}`
    default:
      return applicationWords(message)
  }
}

/**
 * Words the Application pane's lines of a test replay; called by {@link describeNodeTestReplay}.
 * @param message - An Application pane surface and its value.
 * @returns The words.
 * @example applicationWords({ kind: 'application-time', elapsedMs: 420 }) // => 'Recorded test output · 0.42 s'
 */
function applicationWords(
  message: Extract<NodeTestReplayMessage, { kind: `application-${string}` }>,
): string {
  switch (message.kind) {
    case 'application-time':
      return `Recorded test output · ${formatEventSeconds(message.elapsedMs)} s`
    case 'application-test':
      return testName(message.test)
    case 'application-name':
      return message.elapsedMs === undefined
        ? `Recorded test output · ${testName(message.test)}`
        : `Recorded test output · ${testName(message.test)} · ${formatEventSeconds(message.elapsedMs)} s`
    case 'application-region':
      return `Recorded test output up to ${formatEventSeconds(message.elapsedMs)} s`
    case 'application-cut':
      return `… ${message.characters} earlier characters not shown${message.startsMidLine ? '; the first line below is cut' : ''}`
    case 'application-inspector':
      return `${message.lines} Node inspector lines hidden`
  }
}

/**
 * Words the Study section's locator of the selected event; called by {@link describeNodeTestReplay}.
 * @param event - The selected event: a stop with its number and the replay's stop count, an output, or the result with its verdict.
 * @param elapsedMs - The event's time.
 * @returns `Stop <n> of <m> · <t> s`, `Output · <t> s` or `Result · <verdict> · <t> s`.
 * @example positionWords({ type: 'stop', index: 0, stopCount: 2 }, 420) // => 'Stop 1 of 2 · 0.42 s'
 */
function positionWords(
  event: Extract<NodeTestReplayMessage, { kind: 'position' }>['event'],
  elapsedMs: number,
): string {
  if (event.type === 'stop')
    return `Stop ${event.index + 1} of ${event.stopCount} · ${formatEventSeconds(elapsedMs)} s`
  return event.type === 'result'
    ? `Result · ${event.verdict} · ${formatEventSeconds(elapsedMs)} s`
    : `Output · ${formatEventSeconds(elapsedMs)} s`
}

/**
 * Words a sealed or interrupted history's verdict, capture and explained stops, the Saved studies row after `Test replay · ` and the Study pane's status line; called by {@link describeNodeTestReplay}.
 * @param summary - The summary of a history that is no longer recording.
 * @returns The status words.
 * @example studyStatus({ status: 'partial', verdict: 'Test failed · exit code 1', stopCount: 1, explainedStopCount: 0 }) // => 'Test failed · exit code 1 · capture partial · 0 of 1 stops explained'
 */
function studyStatus(
  summary: Omit<NodeTestReplayMessageSummary, 'verification' | 'status'> & {
    status: keyof typeof CAPTURE_WORDS
  },
): string {
  return `${summary.verdict} · capture ${CAPTURE_WORDS[summary.status]} · ${summary.explainedStopCount} of ${summary.stopCount} stops explained`
}

/**
 * Names the cited test as the Application pane's second header line does: the file, then each title of its path after ` › `.
 * @param test - The cited test.
 * @returns `<testFile> › <title> › …`, or the file alone without titles.
 * @example testName({ testFile: 'src/jobs.test.ts', testTitles: ['job scheduler', 'runs a delayed job'] }) // => 'src/jobs.test.ts › job scheduler › runs a delayed job'
 */
function testName(test: NodeTestReplayTestName): string {
  return [test.testFile, ...(test.testTitles ?? [])].join(' › ')
}
