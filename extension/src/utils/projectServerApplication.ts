import { NODE_SERVER_RESPONSE_SHOWN_BYTES } from '../constants'

import { accumulateNodeTestOutput } from './accumulateNodeTestOutput'
import type {
  ServerReplayEvent,
  ServerReplayModel,
} from './buildServerReplayModel'
import { describeScriptEndRegion } from './describeNodeScriptEndRegion'
import { NODE_SCRIPT_REPLAY_TEXT } from './describeNodeScriptReplay'
import {
  describeServerRequestClaim,
  describeServerResponseState,
  NODE_SERVER_REPLAY_TEXT,
} from './describeNodeServerReplay'
import { formatEventSeconds } from './formatEventSeconds'
import { type NodeTestOutputIndex } from './indexNodeTestOutput'
import { nodeRunProfileOf, nodeRunReplayWords } from './nodeRunReplayWords'
import {
  leftOutLines,
  type NodeTestApplicationView,
} from './projectNodeTestApplication'
import { stripTerminalControls } from './stripTerminalControls'

/** What the Application pane shows of a server replay at one moment: the fixed request region, the fixed response region, then the output log. It is the test replay's Application view with its server fields, so one document draws both. Every field is text, rendered as text and never as markup. */
export type NodeServerApplicationView = NodeTestApplicationView & {
  profile: 'node-server' | 'node-script'
}

/** Words the Application pane's first line and name: `Recorded server output` or, for a script replay, `Recorded script output`. */
function timeWords(
  elapsedMs: number | undefined,
  subject: 'server' | 'script',
): string {
  return elapsedMs === undefined
    ? `Recorded ${subject} output`
    : `Recorded ${subject} output · ${formatEventSeconds(elapsedMs)} s`
}

/**
 * Words the end region of a script replay for the selected moment, which takes the place of the response region: before the run's `end` the not-ended-yet line, at or after it how the run ended with the stops it never reached, and for a history that ended with no `end` the reason once the replay reaches its last event.
 * @param model - The script replay model.
 * @param selected - The selected event.
 * @returns The region.
 * @example endRegion(model, selected).state // => 'Exited with code 0'
 */
function endRegion(
  model: ServerReplayModel,
  selected: ServerReplayEvent,
): NonNullable<NodeServerApplicationView['response']> {
  const { terminal } = model
  if (terminal?.type === 'end' && selected.sequence >= terminal.sequence)
    return describeScriptEndRegion(terminal)
  const reachedLast = selected.sequence === model.events.at(-1)?.sequence
  return {
    state:
      terminal || !reachedLast
        ? NODE_SCRIPT_REPLAY_TEXT.noEndYet
        : 'No end was recorded: the history ended before the script ended.',
  }
}

/**
 * Finds the request attempt the selected moment belongs to: the latest attempt opened at or before it, else the no-request-yet state while the history holds a request later.
 * @param model - The replay model.
 * @param selected - The selected event.
 * @returns The attempt's request line and its mark state.
 */
function requestRegion(
  model: ServerReplayModel,
  selected: ServerReplayEvent,
): NodeServerApplicationView['request'] {
  const opened = model.events.filter(
    (event): event is Extract<ServerReplayEvent, { type: 'request' }> =>
      event.type === 'request',
  )
  const request = opened.findLast(
    (event) => event.sequence <= selected.sequence,
  )
  // Before the first request entry the request does not exist yet.
  if (!request)
    return opened.length
      ? { line: NODE_SERVER_REPLAY_TEXT.noRequestYet, claim: '' }
      : undefined
  // The marks count only once the selected moment has reached them: a moment before the send mark or the withdrawal never shows that later outcome.
  const sentMark = model.attempts.find(
    (candidate) => candidate.attempt === request.attempt,
  )?.sentSequence
  const withdrawal = model.events.find(
    (
      event,
    ): event is Extract<ServerReplayEvent, { type: 'request-withdrawn' }> =>
      event.type === 'request-withdrawn' &&
      event.attempt === request.attempt &&
      event.sequence <= selected.sequence,
  )
  // The attempt's later withdrawal, wherever it lies: it is a mark the moment may not have reached yet.
  const laterWithdrawal = model.events.some(
    (event) =>
      event.type === 'request-withdrawn' && event.attempt === request.attempt,
  )
  // A moment before the attempt's own send mark and before its withdrawal: the request is opening, neither sent nor refused. Only an attempt with neither mark (an interrupted history) reads unknown.
  if (
    (sentMark !== undefined || laterWithdrawal) &&
    !(sentMark !== undefined && sentMark <= selected.sequence) &&
    !withdrawal
  )
    return {
      line: `${request.method} ${request.path}`,
      claim: NODE_SERVER_REPLAY_TEXT.requestOpening,
    }
  return {
    line: `${request.method} ${request.path}`,
    claim: describeServerRequestClaim({
      sent: sentMark !== undefined && sentMark <= selected.sequence,
      ...(withdrawal ? { withdrawnCode: withdrawal.code } : {}),
    }),
  }
}

/**
 * Words the response region for the selected moment: before the terminal entry the pre-response line, at or after a response its status, content type and body, for a failed request its code, and for a history that ended with no answer its reason once the replay reaches the end.
 * @param model - The replay model.
 * @param selected - The selected event.
 * @param noResponseReason - The no-response reason of a history that ended with no answer, worded by the capture evaluator.
 * @returns The region.
 */
function responseRegion(
  model: ServerReplayModel,
  selected: ServerReplayEvent,
  noResponseReason: string | undefined,
): NonNullable<NodeServerApplicationView['response']> {
  const { terminal } = model
  // A history with no terminal entry reaches its end at its last event.
  const reached = terminal
    ? selected.sequence >= terminal.sequence
    : selected.sequence === model.events.at(-1)?.sequence
  if (terminal?.type === 'response' && reached) {
    const shownBytes = Buffer.byteLength(terminal.body)
    // Only a read cut or the shown-body bound cuts a body; redaction, control stripping and the binary note shorten it without a cut.
    const cut =
      terminal.readCut || shownBytes > NODE_SERVER_RESPONSE_SHOWN_BYTES
    return {
      state: describeServerResponseState({ reached, response: terminal }),
      ...(terminal.bodyBytes === 0
        ? { note: NODE_SERVER_REPLAY_TEXT.emptyBody }
        : { body: terminal.body }),
      ...(cut && terminal.bodyBytes > 0
        ? { note: `Body shown cut at ${shownBytes} bytes.` }
        : {}),
    }
  }
  return {
    state: describeServerResponseState({
      reached,
      ...(terminal?.type === 'request-failed'
        ? { failureCode: terminal.code }
        : {}),
      ...(noResponseReason ? { noResponseReason } : {}),
    }),
  }
}

/**
 * Words what the replay's header declares the run was: a server's request line, or a script's entry file.
 * @param header - The replay model's header.
 * @returns `<METHOD> <path>` or the script's entry, free of terminal controls.
 * @example describeDeclaredRun(model.header) // => 'POST /api/items'
 */
function describeDeclaredRun(header: ServerReplayModel['header']): string {
  return header.profile === 'node-script'
    ? stripTerminalControls(header.entry)
    : `${header.declaredRequest.method} ${stripTerminalControls(header.declaredRequest.path)}`
}

/**
 * Projects the two fixed regions of the Application pane for the selected moment: a server replay's request and response regions, or a script replay's end region, which takes the place of the response region and has no request region.
 * @param model - The replay model.
 * @param selected - The selected event.
 * @param noResponseReason - The no-response reason of a server history that never answered.
 * @returns The `request` (server only) and `response` fields of the view.
 * @example momentRegions(scriptModel, end, undefined).response.state // => 'Exited with code 0'
 */
function momentRegions(
  model: ServerReplayModel,
  selected: ServerReplayEvent,
  noResponseReason: string | undefined,
): Pick<NodeServerApplicationView, 'request' | 'response'> {
  if (model.header.profile === 'node-script')
    return { response: endRegion(model, selected) }
  const request = requestRegion(model, selected)
  return {
    ...(request ? { request } : {}),
    response: responseRegion(model, selected, noResponseReason),
  }
}

/**
 * Projects what the Application pane shows of a server replay at the selected moment: the request region, the response region and the output log up to the moment, reading the output with the test replay's window, follow and cut rules.
 * Called by the Study workspace for each Study message while a server replay is selected.
 * @param model - The replay model.
 * @param index - The replay's output read once ({@link indexNodeTestOutput} over the journal's output entries).
 * @param selected - The selected event, absent before one is selected.
 * @param options - `generation` supersedes older updates; `loading` shows the opening state; `leaving` names the surface alone while the selection goes elsewhere; `noResponseReason` is the no-response reason of a history that never answered.
 * @returns The view.
 * @example projectServerApplication(model, index, model.events[0], { generation: 1 }).request?.claim // => 'Request sent by Codebook'
 */
export function projectServerApplication(
  model: ServerReplayModel,
  index: NodeTestOutputIndex,
  selected: ServerReplayEvent | undefined,
  options: {
    generation: number
    loading?: boolean
    leaving?: boolean
    noResponseReason?: string
  },
): NodeServerApplicationView {
  const { generation, loading = false, leaving = false } = options
  const words = nodeRunReplayWords(model)
  const profile = nodeRunProfileOf(model)
  const subject = profile === 'node-script' ? 'script' : 'server'
  if (loading || !selected)
    return {
      profile,
      test: '',
      generation,
      time: timeWords(undefined, subject),
      name: words.heading,
      lines: [],
      placeholder: loading
        ? words.loading
        : model.events.length
          ? words.nothingYet
          : words.noEntries,
    }
  const tail = accumulateNodeTestOutput(index, selected.sequence)
  const last = model.events.at(-1)
  const regions = momentRegions(model, selected, options.noResponseReason)
  return {
    profile,
    test: '',
    generation,
    time: timeWords(leaving ? undefined : selected.elapsedMs, subject),
    name: `${words.heading} · ${describeDeclaredRun(model.header)}`,
    ...regions,
    ...(leaving
      ? {}
      : {
          region: `Recorded ${subject} output up to ${formatEventSeconds(selected.elapsedMs)} s`,
        }),
    lines: tail.lines,
    ...leftOutLines(tail),
    ...(tail.hasOutput ? {} : { placeholder: words.nothingYet }),
    // A history that ended with no answer says so at its last event, while the recording is no longer being written.
    ...(model.status !== 'recording' &&
    model.endedBeforeAnswer &&
    last?.sequence === selected.sequence
      ? { end: words.endedEarly }
      : {}),
  }
}
