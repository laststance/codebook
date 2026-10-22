import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import {
  describeNodeTestReplay,
  NODE_TEST_REPLAY_TEXT,
} from './describeNodeTestReplay'
import {
  describeNodeTestResult,
  type NodeTestVerdict,
} from './describeNodeTestResult'
import type { NodeLearningSummaryProjection } from './projectNodeLearningSummary'

/**
 * What the Study pane's test replay section shows beside the selected event (Designs 5 and 6, DS3, DS21): every line already worded, so the pane's client code only places them.
 */
export type NodeTestSectionView = {
  status: string
  /** The selected event's locator (`Stop <n> of <m> · <t> s`, `Output · <t> s`, `Result · <verdict> · <t> s`), absent before a selection. */
  position?: string
  /** The selected step's explanation, or the line that no step explains the selected stop or result; absent for an output without a step. */
  explanation?: string
  /** The 4A line at an output, the result and a stop whose source does not verify. */
  notRecorded?: string
  /** The line for a selected stop whose recorded source does not verify. */
  unverified?: string
  /** Where the output up to the selected moment is, or that its pane is closed. */
  pointer: string
  applicationClosed: boolean
  /** The step shown with the selected event: the one the learner chose, else the event's first. */
  selectedStepId?: string
  /** The selected event's other steps, which read `Same recorded moment`. */
  sameMomentStepIds: string[]
  /** Each step's action label by step id, for the steps whose reference names an event of the history. */
  stepActions: Record<string, string>
  /** The collapsed event list's summary, `Events (<count>)`. */
  events: string
  /** The history's verdict, which the result's row in the event list leads with. */
  verdict: string
  /** Whether a stop lies before and after the selected event, for Previous stop and Next stop. */
  previousStop: boolean
  nextStop: boolean
}

/** The inputs of the section's view. */
export type NodeTestSectionInput = {
  history: Pick<NodeTestHistoryIndex, 'entries' | 'status'>
  selected?: NodeTestHistoryIndex['entries'][number]
  /** Whether the selected event is a stop whose recorded source verifies. */
  selectedStopVerified: boolean
  learning?: NodeLearningSummaryProjection
  /** The step committed with the selected event (DS21); one that names no step of the event falls back to the event's first step. */
  chosenStepId?: string
  applicationClosed: boolean
}

/**
 * Words the Study pane's test replay section for the selected event: status, locator, the selected step and its explanation, the not-recorded lines and the steps that share the moment; called by the Study workspace for each Study message while a test replay is selected.
 * The selected step is the one the learner chose when it references the selected event, else the event's first step (Next and Previous select the event's first step).
 * The status line counts the stops a step of the material references as explained, as Saved studies does.
 * @param input - The history, the selected event, its learning material and the learner's chosen step.
 * @returns The section's view.
 * @example
 * projectNodeTestSection({ history, selected: stop, selectedStopVerified: true, learning, applicationClosed: false }).position // => 'Stop 1 of 2 · 0.42 s'
 */
export function projectNodeTestSection(
  input: NodeTestSectionInput,
): NodeTestSectionView {
  const { history, selected, learning } = input
  const stops = history.entries.filter((entry) => entry.type === 'stop')
  const verdict = historyVerdict(history)
  const moment = momentSteps(selected, learning, input.chosenStepId)
  const explanation = momentExplanation(selected, moment.selectedStep)
  const unverifiedStop =
    selected?.type === 'stop' && !input.selectedStopVerified
  return {
    status: sectionStatus(history, stops, verdict, learning),
    ...(selected ? { position: positionLine(selected, stops.length) } : {}),
    ...(explanation === undefined ? {} : { explanation }),
    // The 4A line stands at an output, the result and a stop whose source does not verify.
    ...(selected && (selected.type !== 'stop' || unverifiedStop)
      ? { notRecorded: NODE_TEST_REPLAY_TEXT.notRecorded }
      : {}),
    ...(unverifiedStop
      ? { unverified: NODE_TEST_REPLAY_TEXT.unverifiedStop }
      : {}),
    pointer: input.applicationClosed
      ? NODE_TEST_REPLAY_TEXT.applicationClosed
      : NODE_TEST_REPLAY_TEXT.outputPointer,
    applicationClosed: input.applicationClosed,
    ...(moment.selectedStepId ? { selectedStepId: moment.selectedStepId } : {}),
    sameMomentStepIds: moment.sameMomentStepIds,
    stepActions: stepActionLabels(history, learning),
    events: describeNodeTestReplay({
      kind: 'events',
      count: history.entries.length,
    }),
    verdict,
    previousStop: stops.some(
      (stop) => selected !== undefined && stop.sequence < selected.sequence,
    ),
    nextStop: stops.some(
      (stop) => selected === undefined || stop.sequence > selected.sequence,
    ),
  }
}

/** An event of a test replay. */
type HistoryEvent = NodeTestHistoryIndex['entries'][number]

/**
 * Words the verdict of a test replay from its result entry; called by {@link projectNodeTestSection}.
 * @param history - The test replay.
 * @returns The verdict, `No result recorded` without a result.
 * @example historyVerdict(history) // => 'Test passed · exit code 0'
 */
function historyVerdict(
  history: Pick<NodeTestHistoryIndex, 'entries'>,
): NodeTestVerdict {
  const result = history.entries.find((entry) => entry.type === 'result')
  return describeNodeTestResult(result?.type === 'result' ? result : undefined)
}

/**
 * Words the section's status line, counting as explained the stops a step of the material references, as Saved studies does; called by {@link projectNodeTestSection}.
 * @param history - The test replay.
 * @param stops - Its stops.
 * @param verdict - Its verdict.
 * @param learning - Its projected material, if any.
 * @returns `<verdict> · capture <…> · <k> of <m> stops explained`.
 * @example sectionStatus(history, stops, 'Test passed · exit code 0', learning) // => 'Test passed · exit code 0 · capture complete · 1 of 2 stops explained'
 */
function sectionStatus(
  history: Pick<NodeTestHistoryIndex, 'status'>,
  stops: readonly HistoryEvent[],
  verdict: NodeTestVerdict,
  learning: NodeLearningSummaryProjection | undefined,
): string {
  const referenced = new Set(
    (learning?.positions ?? []).map((position) => position.sequence),
  )
  return describeNodeTestReplay({
    kind: 'study-status',
    summary: {
      status: history.status,
      verdict,
      stopCount: stops.length,
      explainedStopCount: stops.filter((stop) => referenced.has(stop.sequence))
        .length,
    },
  })
}

/**
 * Words the selected event's locator; called by {@link projectNodeTestSection}.
 * @param selected - The selected event.
 * @param stopCount - How many stops the replay holds.
 * @returns `Stop <n> of <m> · <t> s`, `Output · <t> s` or `Result · <verdict> · <t> s`.
 * @example positionLine(stop, 2) // => 'Stop 1 of 2 · 0.42 s'
 */
function positionLine(selected: HistoryEvent, stopCount: number): string {
  return describeNodeTestReplay({
    kind: 'position',
    event:
      selected.type === 'stop'
        ? { type: 'stop', index: selected.index, stopCount }
        : selected.type === 'result'
          ? { type: 'result', verdict: describeNodeTestResult(selected) }
          : { type: 'output' },
    elapsedMs: selected.elapsedMs,
  })
}

/**
 * Finds the steps of the selected event: the one shown, the learner's choice when it references the event, else the event's first, and the others, which read `Same recorded moment` (DS21); called by {@link projectNodeTestSection}.
 * @param selected - The selected event, if any.
 * @param learning - The projected material, if any.
 * @param chosenStepId - The step committed with the selected event.
 * @returns The shown step's id and content, and the other steps' ids.
 * @example momentSteps(stop, learning, 'keep').selectedStepId // => 'keep'
 */
function momentSteps(
  selected: HistoryEvent | undefined,
  learning: NodeLearningSummaryProjection | undefined,
  chosenStepId: string | undefined,
): {
  selectedStepId?: string
  selectedStep?: NodeLearningSummaryProjection['content']['steps'][number]
  sameMomentStepIds: string[]
} {
  const stepIds = (learning?.positions ?? [])
    .filter((position) => position.sequence === selected?.sequence)
    .map((position) => position.stepId)
  const selectedStepId =
    chosenStepId && stepIds.includes(chosenStepId) ? chosenStepId : stepIds[0]
  const selectedStep = learning?.content.steps.find(
    (step) => step.id === selectedStepId,
  )
  return {
    ...(selectedStepId ? { selectedStepId } : {}),
    ...(selectedStep ? { selectedStep } : {}),
    sameMomentStepIds: stepIds.filter((stepId) => stepId !== selectedStepId),
  }
}

/**
 * Gives the explanation shown under the locator: the shown step's, else the line that no step explains a selected stop or the result; an output without a step needs no line. Called by {@link projectNodeTestSection}.
 * @param selected - The selected event, if any.
 * @param step - The shown step, if any.
 * @returns The explanation, or `undefined` for none.
 * @example momentExplanation(stop, undefined) // => 'No saved explanation for this stop.'
 */
function momentExplanation(
  selected: HistoryEvent | undefined,
  step: { explanation: string } | undefined,
): string | undefined {
  if (step) return step.explanation
  if (selected?.type === 'stop') return NODE_TEST_REPLAY_TEXT.noStepForStop
  return selected?.type === 'result'
    ? NODE_TEST_REPLAY_TEXT.noStepForResult
    : undefined
}

/**
 * Words each step's action by the event its reference names, for the steps whose event the history holds; called by {@link projectNodeTestSection}.
 * The labels are own data properties, so a step id such as `__proto__` keeps its label through the message to the Study pane, where an assignment would hit the prototype's setter and drop it.
 * @param history - The test replay.
 * @param learning - Its projected material, if any.
 * @returns The action labels by step id.
 * @example stepActionLabels(history, learning) // => { read: 'Inspect stop 1 · 0.42 s' }
 */
function stepActionLabels(
  history: Pick<NodeTestHistoryIndex, 'entries'>,
  learning: NodeLearningSummaryProjection | undefined,
): Record<string, string> {
  const events = new Map(
    history.entries.map((entry) => [entry.sequence, entry] as const),
  )
  return Object.fromEntries(
    (learning?.positions ?? []).flatMap((position) => {
      const event = events.get(position.sequence)
      // A step whose event this history lacks gets no action.
      if (!event) return []
      const label = describeNodeTestReplay({
        kind: 'step-action',
        event:
          event.type === 'stop'
            ? { type: 'stop', index: event.index }
            : { type: event.type },
        elapsedMs: event.elapsedMs,
      })
      return [[position.stepId, label] as const]
    }),
  )
}
