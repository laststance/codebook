import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'
import type { StudyViewMessage } from '../ui/studyHtml'

import type { ServerReplayPresentation } from './adaptServerReplay'
import { nodeStopSourceMatches } from './nodeStopSourceMatches'
import {
  projectNodeLearningSummary,
  type NodeLearningMaterialOfHistory,
  type NodeLearningSummaryProjection,
} from './projectNodeLearningSummary'
import type { NodeTestApplicationView } from './projectNodeTestApplication'
import { projectServerApplication } from './projectServerApplication'
import {
  projectServerSection,
  type ServerSectionInput,
} from './projectServerSection'

/** The Application view of the moment last shown and the key it was projected for, kept so the view is projected once per shown moment. */
export type ServerApplicationMemo = {
  key: string
  generation: number
  view: NodeTestApplicationView
}

/** What {@link projectServerReplayViews} needs of the workspace's state, passed in so the projection holds none. */
export type ServerReplayViewsInput = {
  replay: ServerReplayPresentation
  /** The selected event in the replay's test-shaped history. */
  selected: NodeTestHistoryIndex['entries'][number] | undefined
  /** The position of the event a selection is going to, while it loads. */
  leavingPosition: number | undefined
  /** Whether this replay is the one being opened. */
  opening: boolean
  /** The Application view last projected, reused while the shown moment is the same. */
  memo: ServerApplicationMemo | undefined
  /** Gives the next view generation; called only when the view is projected again. */
  nextGeneration: () => number
  learningMaterial: NodeLearningMaterialOfHistory | undefined
  /** The context both profiles' sections share (chosen step, Application pane state, timeline marks). */
  sectionContext: (
    learning: NodeLearningSummaryProjection | undefined,
  ) => Pick<
    ServerSectionInput,
    'learning' | 'chosenStepId' | 'applicationClosed' | 'marks'
  >
}

/**
 * Projects a selected server replay's three views for the Study message with the server catalog, reading the replay model instead of the test journal.
 * The Application view is projected once per shown moment (the memo's key), and a moment the selection is going to names the Study position and the Application header while it loads. Called by {@link StudyWorkspace} for a history that is a server replay's test-shaped view.
 * @param input - The replay, the selection, the memo and the workspace's section context.
 * @returns The views for the Study message and the memo to keep for the next call.
 * @example projectServerReplayViews(input).views.nodeHistorySection?.position // => 'Stop 1 · 0.42 s'
 */
export function projectServerReplayViews(input: ServerReplayViewsInput): {
  views: Pick<
    StudyViewMessage,
    | 'nodeHistoryApplication'
    | 'nodeHistorySection'
    | 'nodeHistoryLearningSummary'
  >
  memo: ServerApplicationMemo
} {
  const { replay, selected } = input
  const { shownModel: model, history } = replay
  const eventAt = (sequence: number | undefined) => {
    const position =
      sequence === undefined ? undefined : model.indexBySequence.get(sequence)
    return position === undefined ? undefined : model.events[position]
  }
  const pendingEvent =
    input.leavingPosition === undefined
      ? undefined
      : model.events[input.leavingPosition]
  const selectedEvent = eventAt(selected?.sequence)
  const key = JSON.stringify([
    model.studyId,
    model.events.length,
    model.status,
    selectedEvent?.sequence,
    input.opening,
    pendingEvent !== undefined,
  ])
  // The view is projected once per shown moment: every refresh publishes, and assembling the output again each time would cost its whole tail.
  let memo = input.memo
  if (memo?.key !== key) {
    const generation = input.nextGeneration()
    memo = {
      key,
      generation,
      view: projectServerApplication(model, replay.outputIndex, selectedEvent, {
        generation,
        loading: input.opening,
        leaving: pendingEvent !== undefined,
        ...(model.endedBeforeAnswer && replay.noResponseReason
          ? { noResponseReason: replay.noResponseReason }
          : {}),
      }),
    }
  }
  const learning = projectNodeLearningSummary(input.learningMaterial, history)
  return {
    memo,
    views: {
      nodeHistoryApplication: memo.view,
      nodeHistorySection: projectServerSection({
        replay,
        ...(pendingEvent
          ? { selected: pendingEvent, pending: true }
          : selectedEvent
            ? { selected: selectedEvent }
            : {}),
        selectedStopVerified:
          selected?.type === 'stop' && nodeStopSourceMatches(selected),
        ...input.sectionContext(learning),
      }),
      ...(learning ? { nodeHistoryLearningSummary: learning } : {}),
    },
  }
}
