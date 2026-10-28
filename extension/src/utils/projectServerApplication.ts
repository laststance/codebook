import { NODE_SERVER_RESPONSE_SHOWN_BYTES } from '../constants'

import { accumulateNodeTestOutput } from './accumulateNodeTestOutput'
import type {
  ServerReplayEvent,
  ServerReplayModel,
} from './buildServerReplayModel'
import {
  describeServerRequestClaim,
  describeServerResponseState,
  NODE_SERVER_REPLAY_TEXT,
} from './describeNodeServerReplay'
import { formatEventSeconds } from './formatEventSeconds'
import { type NodeTestOutputIndex } from './indexNodeTestOutput'
import {
  leftOutLines,
  type NodeTestApplicationView,
} from './projectNodeTestApplication'
import { stripTerminalControls } from './stripTerminalControls'

/** What the Application pane shows of a server replay at one moment: the fixed request region, the fixed response region, then the output log. It is the test replay's Application view with its server fields, so one document draws both. Every field is text, rendered as text and never as markup. */
export type NodeServerApplicationView = NodeTestApplicationView & {
  profile: 'node-server'
}

/** Words the Application pane's first line and name. */
function timeWords(elapsedMs: number | undefined): string {
  return elapsedMs === undefined
    ? 'Recorded server output'
    : `Recorded server output · ${formatEventSeconds(elapsedMs)} s`
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
  if (loading || !selected)
    return {
      profile: 'node-server',
      test: '',
      generation,
      time: timeWords(undefined),
      name: NODE_SERVER_REPLAY_TEXT.heading,
      lines: [],
      placeholder: loading
        ? NODE_SERVER_REPLAY_TEXT.loading
        : model.events.length
          ? NODE_SERVER_REPLAY_TEXT.nothingYet
          : NODE_SERVER_REPLAY_TEXT.noEntries,
    }
  const tail = accumulateNodeTestOutput(index, selected.sequence)
  const last = model.events.at(-1)
  return {
    profile: 'node-server',
    test: '',
    generation,
    time: timeWords(leaving ? undefined : selected.elapsedMs),
    name: `${NODE_SERVER_REPLAY_TEXT.heading} · ${model.header.declaredRequest.method} ${stripTerminalControls(model.header.declaredRequest.path)}`,
    ...(requestRegion(model, selected)
      ? { request: requestRegion(model, selected) }
      : {}),
    response: responseRegion(model, selected, options.noResponseReason),
    ...(leaving
      ? {}
      : {
          region: `Recorded server output up to ${formatEventSeconds(selected.elapsedMs)} s`,
        }),
    lines: tail.lines,
    ...leftOutLines(tail),
    ...(tail.hasOutput
      ? {}
      : { placeholder: NODE_SERVER_REPLAY_TEXT.nothingYet }),
    // A history that ended with no answer says so at its last event, while the recording is no longer being written.
    ...(model.status !== 'recording' &&
    model.endedBeforeAnswer &&
    last?.sequence === selected.sequence
      ? { end: NODE_SERVER_REPLAY_TEXT.endedEarly }
      : {}),
  }
}
