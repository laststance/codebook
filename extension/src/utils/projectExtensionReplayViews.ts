import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'
import type { StudyViewMessage } from '../ui/studyHtml'

import type { ExtensionReplayPresentation } from './adaptExtensionReplay'
import type { ExtensionReplayMoment } from './buildExtensionReplayModel'
import {
  describeExtensionFrameLabel,
  describeExtensionPosition,
  describeExtensionStopGap,
  describeExtensionThread,
  NODE_EXTENSION_REPLAY_TEXT,
} from './describeExtensionReplay'
import { formatEventSeconds } from './formatEventSeconds'
import type { NodeHistoryTimeline } from './projectNodeHistoryTimeline'
import type { NodeTestApplicationView } from './projectNodeTestApplication'
import type { NodeTestSectionView } from './projectNodeTestSection'

/** The Application view of the moment last shown and the key it was projected for, kept so the view is projected once per shown moment. */
export type ExtensionApplicationMemo = {
  key: string
  generation: number
  view: NodeTestApplicationView
}

/** The frame the host loaded for the selected moment: its address, or nothing when the blob could not be shown. */
export type ExtensionShownFrame = {
  /** The event the frame was loaded for. */
  sequence: number
  /** A `data:image/png` address of the verified bytes; absent for a missing or damaged blob. */
  src?: string
  /** The reason code when the frame's blob was missing or damaged at load; the pane then shows the no-frame state for this frame only. */
  damaged?: string
}

/** What {@link projectExtensionReplayViews} needs of the workspace's state, passed in so the projection holds none. */
export type ExtensionReplayViewsInput = {
  replay: ExtensionReplayPresentation
  /** The selected event in the replay's test-shaped history. */
  selected: NodeTestHistoryIndex['entries'][number] | undefined
  /** The position of the event a selection is going to, while it loads. */
  leavingPosition: number | undefined
  /** Whether this replay is the one being opened. */
  opening: boolean
  /** The frame loaded for the selected event. */
  shownFrame: ExtensionShownFrame | undefined
  memo: ExtensionApplicationMemo | undefined
  nextGeneration: () => number
  applicationClosed: boolean
  timeline: NodeHistoryTimeline | undefined
}

/**
 * Projects a selected Extension replay's views for the Study message: the Application pane's recorded frame and the Study section's lines; no learning material until the save path lands.
 * The Application view is projected once per shown moment. Called by {@link StudyWorkspace} for a history that is an Extension replay's test-shaped view.
 * @param input - The replay, the selection, the memo and the workspace's state.
 * @returns The views and the memo to keep for the next call.
 * @example projectExtensionReplayViews(input).views.nodeHistorySection?.position // => 'Page stop 1 · 0.42 s'
 */
export function projectExtensionReplayViews(input: ExtensionReplayViewsInput): {
  views: Pick<StudyViewMessage, 'nodeHistoryApplication' | 'nodeHistorySection'>
  memo: ExtensionApplicationMemo
} {
  const { replay, selected } = input
  const { model } = replay
  const eventPosition = (sequence: number | undefined): number | undefined =>
    sequence === undefined ? undefined : model.indexBySequence.get(sequence)
  const selectedPosition = eventPosition(selected?.sequence)
  const pendingEvent =
    input.leavingPosition === undefined
      ? undefined
      : model.events[input.leavingPosition]
  const shownFrame =
    input.shownFrame?.sequence === selected?.sequence
      ? input.shownFrame
      : undefined
  const key = JSON.stringify([
    model.studyId,
    model.events.length,
    model.status,
    selected?.sequence,
    input.opening,
    pendingEvent !== undefined,
    shownFrame?.src?.length,
    shownFrame?.damaged,
  ])
  let memo = input.memo
  if (memo?.key !== key) {
    const generation = input.nextGeneration()
    memo = {
      key,
      generation,
      view: projectExtensionApplication(replay, selectedPosition, {
        generation,
        loading: input.opening,
        leaving: pendingEvent !== undefined,
        src: shownFrame?.src,
        damaged: shownFrame?.damaged,
      }),
    }
  }
  const selectedMoment =
    selectedPosition === undefined ? undefined : model.moments[selectedPosition]
  const pendingMoment = pendingEvent
    ? model.moments[input.leavingPosition!]
    : undefined
  const sectionMoment = pendingMoment ?? selectedMoment
  return {
    memo,
    views: {
      nodeHistoryApplication: memo.view,
      nodeHistorySection: projectExtensionSection({
        replay,
        position: pendingEvent ? input.leavingPosition : selectedPosition,
        pending: pendingEvent !== undefined,
        isMomentStopVerified: Boolean(sectionMoment?.stop?.hasSource),
        applicationClosed: input.applicationClosed,
        timeline: input.timeline,
      }),
    },
  }
}

/**
 * Projects what the Application pane shows of an Extension replay at one moment: the recorded frame with its label, or the no-frame state.
 * @param replay - The replay.
 * @param position - The selected event's index in the timeline; absent before one is selected.
 * @param options - The view's generation, whether the replay is opening or leaving the shown moment, and the loaded frame's address.
 * @returns The view; its `frame.label` is the recorded label or `No recorded frame at this moment`.
 * @example projectExtensionApplication(replay, 0, { generation: 1, loading: false, leaving: false, src }).frame?.label // => 'Recorded frame captured at this stop'
 */
function projectExtensionApplication(
  replay: ExtensionReplayPresentation,
  position: number | undefined,
  options: {
    generation: number
    loading: boolean
    leaving: boolean
    src: string | undefined
    damaged: string | undefined
  },
): NodeTestApplicationView {
  const { header } = replay.model
  const test = `${header.extension.name} ${header.extension.version} · ${header.surface.kind}`
  const base = {
    generation: options.generation,
    profile: 'chrome-extension' as const,
    test,
    lines: [],
  }
  const moment =
    position === undefined ? undefined : replay.model.moments[position]
  if (options.loading || !moment)
    return {
      ...base,
      time: 'Recorded extension frame',
      name: `Recorded extension frame · ${test}`,
      placeholder: options.loading
        ? NODE_EXTENSION_REPLAY_TEXT.loading
        : replay.model.events.length
          ? NODE_EXTENSION_REPLAY_TEXT.nothingYet
          : NODE_EXTENSION_REPLAY_TEXT.noEntries,
    }
  const time = options.leaving
    ? 'Recorded extension frame'
    : `Recorded extension frame · ${formatEventSeconds(moment.event.timeMs)} s`
  const frame = moment.frame
  return {
    ...base,
    time,
    name: `${time} · ${test}`,
    frame: {
      // A frame whose blob is damaged is the no-frame state for this moment, with its reason.
      label: options.damaged
        ? NODE_EXTENSION_REPLAY_TEXT.noFrame
        : describeExtensionFrameLabel(frame),
      ...(options.damaged ? { reason: options.damaged } : {}),
      ...(options.src && frame.state !== 'none'
        ? {
            src: options.src,
            width: frame.frame.width,
            height: frame.frame.height,
          }
        : {}),
    },
  }
}

/** The inputs of an Extension replay's Study section. */
type ExtensionSectionInput = {
  replay: ExtensionReplayPresentation
  /** The selected (or going-to) event's index in the timeline. */
  position: number | undefined
  pending: boolean
  isMomentStopVerified: boolean
  applicationClosed: boolean
  timeline: NodeHistoryTimeline | undefined
}

/**
 * Words the section's status line: the result, the capture state and how many stops the run reached; a history still recording says so.
 * @param replay - The replay.
 * @param stopCount - How many stops the journal holds.
 * @returns `Result changed · capture complete · 2 stops`, or `Extension replay · recording`.
 * @example sectionStatus(replay, 2) // => 'Result changed · capture complete · 2 stops'
 */
function sectionStatus(
  replay: ExtensionReplayPresentation,
  stopCount: number,
): string {
  const { model } = replay
  if (model.status === 'recording')
    return `${NODE_EXTENSION_REPLAY_TEXT.heading} · recording`
  const result = model.result
    ? `Result ${model.result.outcome}`
    : 'No result recorded'
  return `${result} · capture ${model.status} · ${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}`
}

/**
 * Words the section's locator: the event, the stop it lies in when it is not the stop's own opening, and the loading suffix while the selection is only going there.
 * @param moment - The moment at the selected event.
 * @param model - The replay model.
 * @param pending - Whether the moment is only the one a selection is going to.
 * @returns The locator.
 * @example sectionPosition(moment, model, false) // => 'Frame · 0.30 s · at page stop 1 · popup.js:2'
 */
function sectionPosition(
  moment: ExtensionReplayMoment,
  model: ExtensionReplayPresentation['model'],
  pending: boolean,
): string {
  const inside =
    moment.stop && moment.event.type !== 'pause-open'
      ? ` · at ${describeExtensionThread(moment.stop).replace('Recorded ', '')}`
      : ''
  return (
    describeExtensionPosition(moment.event, model) +
    inside +
    (pending ? NODE_EXTENSION_REPLAY_TEXT.loadingSuffix : '')
  )
}

/**
 * Words the not-recorded lines of a settled moment: no source and debugger at a moment without a stop or with a partial one, and that the stop's source is unavailable when it cannot be proven.
 * @param moment - The moment, absent before a selection.
 * @param isStopVerified - Whether the moment's stop has its source proven.
 * @param pending - Whether the moment is only the one a selection is going to, which has no such lines yet.
 * @returns `notRecorded` and `unverified` where they apply.
 * @example momentLines(moment, false, false).unverified // => 'Recorded source unavailable for this stop.'
 */
function momentLines(
  moment: ExtensionReplayMoment | undefined,
  isStopVerified: boolean,
  pending: boolean,
): Pick<NodeTestSectionView, 'notRecorded' | 'unverified'> {
  if (pending || !moment) return {}
  const stop = moment.stop
  const lacksNative = !stop || Boolean(describeExtensionStopGap(stop))
  return {
    ...(lacksNative
      ? { notRecorded: NODE_EXTENSION_REPLAY_TEXT.notRecorded }
      : {}),
    ...(stop && !isStopVerified
      ? { unverified: NODE_EXTENSION_REPLAY_TEXT.unverifiedStop }
      : {}),
  }
}

/**
 * Words the Study pane's section for an Extension replay with the extension catalog: status, locator, the not-recorded lines for a moment without a stop or with a partial one, the capture reasons and the stop moves. It has the shape of {@link NodeTestSectionView}, so the pane's one section renderer draws it.
 * @param input - The replay and the selection.
 * @returns The section's view.
 * @example projectExtensionSection(input).notRecorded // => 'Source and debugger not recorded at this moment.' with no stop open
 */
function projectExtensionSection(
  input: ExtensionSectionInput,
): NodeTestSectionView {
  const { replay, position } = input
  const { model } = replay
  const moment = position === undefined ? undefined : model.moments[position]
  const stopPositions = model.events.flatMap((event, at) =>
    event.type === 'pause-open' ? [at] : [],
  )
  const hasCaptureReasons =
    (model.status === 'partial' || model.status === 'interrupted') &&
    replay.captureReasons.length > 0
  return {
    status: sectionStatus(replay, stopPositions.length),
    ...(hasCaptureReasons
      ? {
          captureReason: `Capture ${model.status}: ${replay.captureReasons.join('; ')}`,
        }
      : {}),
    ...(moment
      ? { position: sectionPosition(moment, model, input.pending) }
      : {}),
    ...momentLines(moment, input.isMomentStopVerified, input.pending),
    pointer: input.applicationClosed
      ? NODE_EXTENSION_REPLAY_TEXT.applicationClosed
      : NODE_EXTENSION_REPLAY_TEXT.outputPointer,
    applicationClosed: input.applicationClosed,
    sameMomentStepIds: [],
    stepActions: {},
    events: `Events (${model.events.length})`,
    verdict: model.result
      ? `Result ${model.result.outcome}`
      : 'No result recorded',
    previousStop: stopPositions.some(
      (at) => position !== undefined && at < position,
    ),
    nextStop: stopPositions.some(
      (at) => position === undefined || at > position,
    ),
    ...(input.timeline ? { timeline: input.timeline } : {}),
  }
}

/**
 * Finds the event a Previous or Next move reaches in an Extension replay: by position on the timeline, because the journal sequence of a frame received before a pause can follow the pause's.
 * @param entries - The replay's test-shaped entries in timeline order.
 * @param current - The sequence of the event the learner is at; none before a selection.
 * @param direction - The way to move.
 * @param unit - `stop` moves between recorded stops, `event` between all events.
 * @returns The sequence to select; `undefined` when there is none that way.
 * @example extensionStepTarget(entries, 9, 'next', 'stop') // => 14
 */
export function extensionStepTarget(
  entries: readonly NodeTestHistoryIndex['entries'][number][],
  current: number | undefined,
  direction: 'previous' | 'next',
  unit: 'event' | 'stop',
): number | undefined {
  const at = entries.findIndex((entry) => entry.sequence === current)
  const indexes = entries.flatMap((entry, index) =>
    unit === 'event' || entry.type === 'stop' ? [index] : [],
  )
  if (at < 0)
    return entries[(direction === 'next' ? indexes[0] : indexes.at(-1)) ?? -1]
      ?.sequence
  const target =
    direction === 'next'
      ? indexes.find((index) => index > at)
      : indexes.findLast((index) => index < at)
  return target === undefined ? undefined : entries[target]?.sequence
}
