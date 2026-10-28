import type { ServerReplayPresentation } from './adaptServerReplay'
import type { ServerReplayEvent } from './buildServerReplayModel'
import {
  describeServerAnswer,
  describeServerPosition,
  describeServerStepAction,
  describeServerStudyStatus,
  NODE_SERVER_REPLAY_TEXT,
} from './describeNodeServerReplay'
import type { NodeHistoryTimeline } from './projectNodeHistoryTimeline'
import type { NodeLearningSummaryProjection } from './projectNodeLearningSummary'
import {
  momentSteps,
  stopMoves,
  type NodeTestSectionView,
} from './projectNodeTestSection'

/** The inputs of a server replay's Study section. */
export type ServerSectionInput = {
  replay: ServerReplayPresentation
  /** The selected event, from the shown model; absent before one is selected. */
  selected?: ServerReplayEvent
  /** Whether the selected event is a stop whose recorded source verifies. */
  selectedStopVerified: boolean
  learning?: NodeLearningSummaryProjection
  chosenStepId?: string
  applicationClosed: boolean
  marks?: { timeline?: NodeHistoryTimeline }
  /** `true` while the selected event is only the moment a selection is going to. */
  pending?: boolean
}

/**
 * Words the Study pane's section for a server replay with the server catalog: status, locator, the selected step and its explanation, the not-recorded lines, every capture reason and the steps that share the moment. It has the shape of {@link NodeTestSectionView}, so the pane's one section renderer draws it.
 * Called by the Study workspace for each Study message while a server replay is selected.
 * @param input - The replay, the selected event, its learning material and the learner's chosen step.
 * @returns The section's view.
 * @example projectServerSection({ replay, selected: stop, selectedStopVerified: true, applicationClosed: false, marks: {} }).position // => 'Stop 1 · 0.42 s'
 */
export function projectServerSection(
  input: ServerSectionInput,
): NodeTestSectionView {
  const { replay, selected, learning } = input
  const model = replay.shownModel
  const moment = input.pending
    ? { sameMomentStepIds: [] as string[] }
    : momentSteps(selected, learning, input.chosenStepId)
  const stops = model.events.filter((event) => event.type === 'stop')
  const answer = describeServerAnswer(model.terminal)
  return {
    status: statusLine(input, stops, answer),
    ...captureReasonLine(model.status, replay.captureReasons),
    ...(selected
      ? {
          position:
            describeServerPosition(selected, model) +
            (input.pending ? NODE_SERVER_REPLAY_TEXT.loadingSuffix : ''),
        }
      : {}),
    ...momentLines(input, moment),
    pointer: input.applicationClosed
      ? NODE_SERVER_REPLAY_TEXT.applicationClosed
      : NODE_SERVER_REPLAY_TEXT.outputPointer,
    applicationClosed: input.applicationClosed,
    ...('selectedStepId' in moment && moment.selectedStepId
      ? { selectedStepId: moment.selectedStepId }
      : {}),
    sameMomentStepIds: moment.sameMomentStepIds,
    stepActions: stepActionLabels(replay, learning),
    events: `Events (${model.events.length})`,
    verdict: answer,
    ...stopMoves(stops, selected),
    ...(input.marks?.timeline ? { timeline: input.marks.timeline } : {}),
  }
}

/**
 * Words the section's status line, counting as explained the stops a step of the material references.
 * @param input - The section's inputs.
 * @param stops - The replay's stop events.
 * @param answer - How the replay answered.
 * @returns `<answer> · capture <status> · <k> of <m> stops explained`, or the recording line.
 * @example statusLine(input, stops, 'Response 201') // => 'Response 201 · capture complete · 1 of 2 stops explained'
 */
function statusLine(
  input: ServerSectionInput,
  stops: readonly ServerReplayEvent[],
  answer: string,
): string {
  const referenced = new Set(
    (input.learning?.positions ?? []).map((position) => position.sequence),
  )
  return describeServerStudyStatus({
    status: input.replay.shownModel.status,
    answer,
    stopCount: stops.length,
    explainedStopCount: stops.filter((stop) => referenced.has(stop.sequence))
      .length,
  })
}

/**
 * Words the lines under the locator: the explanation, the 4A not-recorded line (at every moment that is not a stop with recorded source) and the line for a stop whose source is unavailable; a moment that is only pending has none.
 * @param input - The section's inputs.
 * @param moment - The steps of the selected event.
 * @returns The lines that apply.
 * @example momentLines(input, moment).notRecorded // => 'Source and debugger not recorded at this moment.' at an output
 */
function momentLines(
  input: ServerSectionInput,
  moment: ReturnType<typeof momentSteps>,
): Pick<NodeTestSectionView, 'explanation' | 'notRecorded' | 'unverified'> {
  const { selected } = input
  if (input.pending || !selected) return {}
  const explanation = momentExplanation(selected, moment)
  const unverifiedStop = selected.type === 'stop' && !input.selectedStopVerified
  return {
    ...(explanation === undefined ? {} : { explanation }),
    ...(selected.type !== 'stop' || unverifiedStop
      ? { notRecorded: NODE_SERVER_REPLAY_TEXT.notRecorded }
      : {}),
    ...(unverifiedStop && selected.type === 'stop'
      ? { unverified: unverifiedSourceLine(selected) }
      : {}),
  }
}

/**
 * Words the capture-reason line: every reason the capture is partial or interrupted, so the replay says all of them where a library row says the first and a count.
 * @param status - The history's status.
 * @param reasons - Every worded reason.
 * @returns `{ captureReason }` for a partial or interrupted history that has a reason; nothing otherwise.
 * @example captureReasonLine('partial', ['A', 'B']) // => { captureReason: 'Capture partial: A; B' }
 */
function captureReasonLine(
  status: ServerSectionInput['replay']['model']['status'],
  reasons: readonly string[],
): { captureReason?: string } {
  if ((status !== 'partial' && status !== 'interrupted') || !reasons.length)
    return {}
  return { captureReason: `Capture ${status}: ${reasons.join('; ')}` }
}

/**
 * Words why a stop's recorded source is not shown, with the reason the debugger snapshot names when it names one (the source was too large to store).
 * @param stop - The selected stop.
 * @returns The catalog's line, ending in the reason when known.
 * @example unverifiedSourceLine(stop) // => 'Recorded source unavailable for this stop (too large).'
 */
function unverifiedSourceLine(
  stop: Extract<ServerReplayEvent, { type: 'stop' }>,
): string {
  const reason = stop.debuggerSnapshot.frames[0]?.sourceUnavailable
  return reason
    ? `${NODE_SERVER_REPLAY_TEXT.unverifiedStop.replace(/\.$/, '')} (${reason}).`
    : NODE_SERVER_REPLAY_TEXT.unverifiedStop
}

/**
 * Gives the explanation shown under the locator: the shown step's, else the line that no step explains a selected stop or response; a request or output without a step needs no line.
 * @param selected - The selected event, if any.
 * @param moment - The steps of the selected event.
 * @returns The explanation, or `undefined` for none.
 * @example momentExplanation(stop, { sameMomentStepIds: [] }) // => 'No saved explanation for this stop.'
 */
function momentExplanation(
  selected: ServerReplayEvent | undefined,
  moment: ReturnType<typeof momentSteps>,
): string | undefined {
  if (moment.selectedStep) return moment.selectedStep.explanation
  if (selected?.type === 'stop') return NODE_SERVER_REPLAY_TEXT.noStepForStop
  return selected?.type === 'response' || selected?.type === 'request-failed'
    ? NODE_SERVER_REPLAY_TEXT.noStepForResult
    : undefined
}

/**
 * Words each step's action by the event its reference names, for the steps whose event the replay holds.
 * The labels are own data properties, so a step id such as `__proto__` keeps its label.
 * @param replay - The replay.
 * @param learning - The projected material, if any.
 * @returns The action labels by step id.
 * @example stepActionLabels(replay, learning) // => { read: 'Inspect Stop 1 · 0.42 s' }
 */
function stepActionLabels(
  replay: ServerReplayPresentation,
  learning: NodeLearningSummaryProjection | undefined,
): Record<string, string> {
  const model = replay.shownModel
  return Object.fromEntries(
    (learning?.positions ?? []).flatMap((position) => {
      const at = model.indexBySequence.get(position.sequence)
      const event = at === undefined ? undefined : model.events[at]
      return event
        ? [[position.stepId, describeServerStepAction(event, model)] as const]
        : []
    }),
  )
}
