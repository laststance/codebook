import type { NodeScriptHistorySummary } from '../nodeScriptHistoryTypes'

import { describeServerRowStatus } from './describeNodeServerReplay'
import type { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'

/**
 * The fixed words of a script replay's surfaces: the script counterpart of the server replay's catalog, with the same keys the pane swaps catalogs by and the script's own words for its end. A script has no request or response, so those keys have no counterpart here.
 * The Study pane receives them through its options, as its client code imports nothing.
 */
export const NODE_SCRIPT_REPLAY_TEXT = {
  stderrMark: '[stderr] ',
  loading: 'Loading recorded script output…',
  nothingYet: 'No script output recorded up to this moment.',
  noEntries: 'No script output recorded.',
  endedEarly: 'Recording ended before the script ended.',
  loadingSuffix: ' · loading…',
  jumpToLatest: 'Jump to latest',
  applicationFooter:
    'Historical script output and end. Reading it does not run the script again.',
  heading: 'Script replay',
  noStepForStop: 'No saved explanation for this stop.',
  noStepForResult: 'No saved explanation for the end of the run.',
  notRecorded: 'Source and debugger not recorded at this moment.',
  unverifiedStop: 'Recorded source unavailable for this stop.',
  outputPointer:
    'Output and the end of the run up to this moment are in the Application pane.',
  applicationClosed: 'The Application pane is closed.',
  showRecordedOutput: 'Show recorded output',
  noMaterial:
    'No learning summary was saved for this script replay. The chat can save one with codebook_explain_node_history.',
  sameMoment: 'Same recorded moment',
  previousStop: 'Previous stop',
  nextStop: 'Next stop',
  previousEvent: 'Previous event',
  nextEvent: 'Next event',
  play: 'Play',
  pause: 'Pause',
  stepDetails: 'Step details',
  playingStatus: 'Script replay playing',
  pausedStatus: 'Script replay paused',
  showMore: 'Show more',
  showLess: 'Show less',
  eventsGroup: 'Event steps',
  stepHeading: 'Step',
  timelineLegend:
    'Ticks mark recorded stops; source and debugger are not recorded between them.',
  noSelection: 'Select an event to move through the recorded script history.',
  chooseReplay:
    'Choose a script replay from Saved studies to step through its output, debugger stops and end.',
  noReplay: 'No script replay has been saved in this workspace.',
  noLinkedEvent: 'No recorded event is linked to this step.',
  eventOutput: 'Output',
  eventStop: 'Stop',
  eventResult: 'End',
  understanding: 'I understand this script history',
  /** The end region before the run's `end` entry. */
  noEndYet: 'The run had not ended at this moment.',
  /** Why Open answers a script replay another window is still recording. */
  stillRecording:
    'This script replay is still being recorded in another window. It opens once the recording is sealed or interrupted.',
  recordedTime: 'recorded script time',
  noRecordedTime: 'No recorded script time selected',
  journalPlayback: 'Script journal playback',
  playLabel: 'Play script replay',
  pauseLabel: 'Pause script replay',
  understandingNote:
    'Only your explicit choice is saved; an exit code never marks understanding.',
  sequenceLabel: 'Script replay learning sequence',
} as const satisfies Readonly<
  Record<keyof typeof NODE_TEST_REPLAY_TEXT, string>
> &
  Readonly<Record<string, string>>

/**
 * Words the line a script replay shows when the history's summary could not be read at open, so the learning verdict is unknown rather than "explanation not saved".
 * Called by the Study workspace when it opens a script history whose summary failed.
 * @param cause - The failure, already sanitized of private paths.
 * @returns One line that names the cause.
 * @example describeScriptSummaryFailure('journal unreadable') // => 'Learning status of this script replay could not be read: journal unreadable'
 */
export function describeScriptSummaryFailure(cause: string): string {
  return `Learning status of this script replay could not be read: ${cause}`
}

/**
 * Words how a script run ended for a Saved studies row: its exit code, or the kind of end when it has none.
 * @param summary - The history's summary as the library reads it.
 * @returns `exit code 0`, `exit code unknown`, `ended by a signal`, `stopped`, `ended at a limit`, `no end recorded` for a finished history without an `end`, or an empty text while it records.
 * @example describeScriptEnd({ endKind: 'exited', exitCode: 3, … }) // => 'exit code 3'
 */
function describeScriptEnd(
  summary: Pick<
    NodeScriptHistorySummary,
    'endKind' | 'exitCode' | 'verification' | 'status'
  >,
): string {
  switch (summary.endKind) {
    case 'exited':
      return summary.exitCode === undefined || summary.exitCode === null
        ? 'exit code unknown'
        : `exit code ${summary.exitCode}`
    case 'signal':
      return 'ended by a signal'
    case 'stopped':
      return 'stopped'
    case 'limit':
      return 'ended at a limit'
    case undefined:
      return summary.verification === 'verified' &&
        summary.status !== 'recording'
        ? 'no end recorded'
        : ''
  }
}

/**
 * Words one Saved studies row of a script history: it leads with the saved learning title (else the question), then `Script replay · <entry> → <end> · <k> of <m> stops`, then its status, so two replays of one script are told apart by what they explain. A partial run is a row like a complete one, with its missing parts named by the status.
 * Called by the Study workspace for each script history of the library and by the notices that name one.
 * @param summary - The history's summary as the library reads it.
 * @returns The row's outcome text.
 * @example describeScriptReplayRow(summary) // => 'Counting items · Script replay · scripts/count.mjs → exit code 0 · 2 of 3 stops · Partial: Declared stop 3 was not reached.'
 */
export function describeScriptReplayRow(
  summary: NodeScriptHistorySummary,
): string {
  const end = describeScriptEnd(summary)
  return `${summary.title ?? summary.question} · Script replay · ${summary.entry}${end ? ` → ${end}` : ''} · ${summary.reachedStopCount} of ${summary.declaredStopCount} stops · ${describeServerRowStatus(summary)}`
}
