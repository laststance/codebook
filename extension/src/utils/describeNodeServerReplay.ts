import type { NodeServerHistorySummary } from '../nodeServerHistoryTypes'

/**
 * The fixed words of a server replay's surfaces: the server counterpart of `NODE_TEST_REPLAY_TEXT`, with the same keys (so a surface swaps catalogs by profile) and the server's own words for the request, the response and the understanding. Part of the node-server UI adapter: the storage layer never imports it.
 * The Study pane receives them through its options, as its client code imports nothing.
 */
export const NODE_SERVER_REPLAY_TEXT = {
  stderrMark: '[stderr] ',
  loading: 'Loading recorded server output…',
  nothingYet: 'No server output recorded up to this moment.',
  noEntries: 'No server output recorded.',
  endedEarly: 'Recording ended before the server answered.',
  loadingSuffix: ' · loading…',
  jumpToLatest: 'Jump to latest',
  applicationFooter:
    'Historical server request and output. Reading it does not resend the request or restart the server.',
  heading: 'Server replay',
  noStepForStop: 'No saved explanation for this stop.',
  noStepForResult: 'No saved explanation for the response.',
  notRecorded: 'Source and debugger not recorded at this moment.',
  unverifiedStop: 'Recorded source unavailable for this stop.',
  outputPointer:
    'Request, response and output up to this moment are in the Application pane.',
  applicationClosed: 'The Application pane is closed.',
  showRecordedOutput: 'Show recorded output',
  noMaterial:
    'No learning summary was saved for this server replay. The chat can save one with codebook_explain_node_history.',
  sameMoment: 'Same recorded moment',
  previousStop: 'Previous stop',
  nextStop: 'Next stop',
  previousEvent: 'Previous event',
  nextEvent: 'Next event',
  play: 'Play',
  pause: 'Pause',
  stepDetails: 'Step details',
  playingStatus: 'Server replay playing',
  pausedStatus: 'Server replay paused',
  showMore: 'Show more',
  showLess: 'Show less',
  eventsGroup: 'Event steps',
  stepHeading: 'Step',
  timelineLegend:
    'Ticks mark recorded stops; source and debugger are not recorded between them.',
  noSelection: 'Select an event to move through the recorded server history.',
  chooseReplay:
    'Choose a server replay from Saved studies to step through its request, output, debugger stops and response.',
  noReplay: 'No server replay has been saved in this workspace.',
  noLinkedEvent: 'No recorded event is linked to this step.',
  eventRequest: 'Request',
  eventOutput: 'Output',
  eventStop: 'Stop',
  eventResult: 'Response',
  /** The understanding checkbox's label. */
  understanding: 'I understand this server history',
  /** Labels the fixed request region of the Application pane when the request's bytes left. */
  requestSent: 'Request sent by Codebook',
  /** The fixed response region before the response entry. */
  noResponseYet: 'No response recorded yet at this moment.',
  emptyBody: 'Response body is empty.',
  /** Names the slider for a screen reader. */
  recordedTime: 'recorded server time',
  /** The label of the sequence diagram's group. */
  sequenceLabel: 'Server replay learning sequence',
} as const

/**
 * Words the request region of the Application pane: the request line with the claim the replay may make about it.
 * @param input - The request line, and what the journal recorded about the attempt's send and refusal.
 * @returns `Request sent by Codebook` only when the bytes were handed to the socket, else `Request not sent: <code>` (the refusal's code, or `unknown`).
 * @example describeServerRequestClaim({ sent: true }) // => 'Request sent by Codebook'
 */
export function describeServerRequestClaim(input: {
  sent: boolean
  withdrawnCode?: string
}): string {
  return input.sent
    ? NODE_SERVER_REPLAY_TEXT.requestSent
    : `Request not sent: ${input.withdrawnCode ?? 'unknown'}`
}

/**
 * Words the response region of the Application pane for the selected moment.
 * @param input - What the history recorded and whether the selected moment reached it: `response` the recorded answer, `failure` the request's failure code, `reason` the first partial reason of a history that ended with neither.
 * @returns One line: the pre-response line, `Response <status> · <content type>`, `Request failed: <code>` or `No response was recorded: <reason>` (the reason already starts with that phrase when the evaluator worded it, so it is not repeated).
 * @example describeServerResponseState({ reached: true, response: { status: 404, contentType: 'text/plain' } }) // => 'Response 404 · text/plain'
 */
export function describeServerResponseState(input: {
  reached: boolean
  response?: { status: number; contentType: string | null }
  failureCode?: string
  noResponseReason?: string
}): string {
  if (!input.reached) return NODE_SERVER_REPLAY_TEXT.noResponseYet
  if (input.response)
    return `Response ${input.response.status} · ${input.response.contentType ?? 'no content type'}`
  if (input.failureCode) return `Request failed: ${input.failureCode}`
  return (
    input.noResponseReason ??
    'No response was recorded: the history ended before the server answered.'
  )
}

/**
 * Words a stop's place in the replay: `Stop <n>` for the first hit and `Stop <n> · hit <k>` for a later one of a stop that was hit again.
 * @param stopNumber - The declared stop's number, counted from 1.
 * @param hit - The hit's number, counted from 1.
 * @param hitMoreThanOnce - Whether the declared stop has more than one recorded hit.
 * @returns The words.
 * @example describeServerStop(2, 3, true) // => 'Stop 2 · hit 3'
 */
export function describeServerStop(
  stopNumber: number,
  hit: number,
  hitMoreThanOnce: boolean,
): string {
  return hitMoreThanOnce
    ? `Stop ${stopNumber} · hit ${hit}`
    : `Stop ${stopNumber}`
}

/** What a saved row words: the status after `Server replay · <request line> → <answer>`. */
function describeServerRowStatus(summary: NodeServerHistorySummary): string {
  if (summary.verification === 'unavailable') return 'Unavailable'
  if (summary.status === 'recording') return 'Recording'
  if (summary.status === 'interrupted')
    return `Interrupted: ${summary.captureMissing[0]?.text ?? summary.reason ?? 'the recording ended without a seal'}`
  if (!summary.captureComplete) {
    const [first] = summary.captureMissing
    const more = summary.captureMissingCount - 1
    return `Partial: ${first?.text ?? summary.reason ?? 'the capture is incomplete'}${more > 0 ? ` (+${more} more)` : ''}`
  }
  // A complete capture is saved once the chat's explanation covers it.
  if (summary.learningCoverage === 'complete') return 'Saved'
  return summary.learningCoverage === 'none'
    ? "Partial: the chat's explanation is not saved yet"
    : `Partial: the explanation does not cover ${summary.learningMissingCount} recorded ${summary.learningMissingCount === 1 ? 'entry' : 'entries'}`
}

/**
 * Words one Saved studies row of a server history: it leads with the saved learning title (else the question), then `Server replay · <METHOD> <path> → <status>` (or `→ <code>`), then its status, so two replays of one route are told apart by what they explain.
 * Called by the Study workspace for each server history of the library and by the removal and open notices that name one.
 * @param summary - The history's summary as the library reads it.
 * @returns The row's outcome text.
 * @example describeServerReplayRow(summary) // => 'Creating an item · Server replay · POST /api/items → 201 · Saved'
 */
export function describeServerReplayRow(
  summary: NodeServerHistorySummary,
): string {
  const answer =
    summary.responseStatus !== undefined
      ? ` → ${summary.responseStatus}`
      : summary.requestFailureCode
        ? ` → ${summary.requestFailureCode}`
        : summary.verification === 'verified' && summary.status !== 'recording'
          ? ' → no response'
          : ''
  return `${summary.title ?? summary.question} · Server replay · ${summary.requestLine}${answer} · ${describeServerRowStatus(summary)}`
}
