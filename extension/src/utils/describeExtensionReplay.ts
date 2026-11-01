import type { ExtensionPauseCloseReason } from '../chromeExtensionHistorySchemas'
import type { ExtensionHistorySummary } from '../chromeExtensionHistoryTypes'

import type {
  ExtensionMomentFrame,
  ExtensionReplayEvent,
  ExtensionReplayModel,
  ExtensionReplayPause,
} from './buildExtensionReplayModel'
import { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'
import { formatEventSeconds } from './formatEventSeconds'
import { stripTerminalControls } from './stripTerminalControls'

/**
 * The fixed words of an Extension replay's surfaces: the test replay's keys (so a surface swaps catalogs by profile) with the extension's own words for the frame, the stops and the understanding. Part of the chrome-extension UI adapter; the storage layer never imports it.
 */
export const NODE_EXTENSION_REPLAY_TEXT = {
  ...NODE_TEST_REPLAY_TEXT,
  loading: 'Loading the recorded extension frame…',
  nothingYet: 'No extension frame recorded up to this moment.',
  noEntries: 'No extension frame recorded.',
  endedEarly: 'Recording ended before the extension run finished.',
  applicationFooter:
    'Recorded extension frame. Reading it does not run Chrome or the extension.',
  heading: 'Extension replay',
  noStepForResult: 'No saved explanation for the result.',
  outputPointer:
    'The recorded extension frame at this moment is in the Application pane.',
  showRecordedOutput: 'Show recorded frame',
  noMaterial:
    'No learning summary was saved for this Extension replay. The chat can save one with codebook_explain_node_history.',
  playingStatus: 'Extension replay playing',
  pausedStatus: 'Extension replay paused',
  noSelection: 'Select an event to move through the recorded extension run.',
  chooseReplay:
    'Choose an Extension replay from Saved studies to step through its frames and debugger stops.',
  noReplay: 'No Extension replay has been saved in this workspace.',
  eventOutput: 'Frame',
  eventResult: 'Result',
  understanding: 'I understand this extension run',
  understandingNote:
    'Only your explicit choice is saved; a recorded frame never marks understanding.',
  recordedTime: 'recorded extension time',
  noRecordedTime: 'No recorded extension time selected',
  journalPlayback: 'Extension journal playback',
  playLabel: 'Play Extension replay',
  pauseLabel: 'Pause Extension replay',
  sequenceLabel: 'Extension replay learning sequence',
  /** Why Open answers an Extension replay another window is still recording. */
  stillRecording:
    'This Extension replay is still being recorded. It opens once the recording is sealed or interrupted.',
  /** The Application pane's frame region when the moment has no frame to show. */
  noFrame: 'No recorded frame at this moment',
} as const

/** The words of one event in the Study pane's event list. */
export type ExtensionReplayEventRow = { heading: string; body: string }

/**
 * Words the context of a stop for a thread and a locator.
 * @param context - The pause's recorded context.
 * @returns `page` or `service worker`; any other context as recorded.
 * @example describeExtensionContext('service-worker') // => 'service worker'
 */
function describeExtensionContext(context: string): string {
  return context === 'service-worker' ? 'service worker' : context
}

/**
 * Words what a stop's journal lacks, for the debugger thread and the locator; empty for a complete stop.
 * @param stop - The pause.
 * @returns ` · source not recorded`, ` · source and values not recorded`; empty when both are recorded.
 * @example describeExtensionStopGap({ hasSnapshot: true, hasSource: false }) // => ' · source not recorded'
 */
export function describeExtensionStopGap(
  stop: Pick<ExtensionReplayPause, 'hasSnapshot' | 'hasSource'>,
): string {
  if (stop.hasSnapshot && stop.hasSource) return ''
  return stop.hasSnapshot
    ? ' · source not recorded'
    : ' · source and values not recorded'
}

/**
 * Words the thread of a stop, the label the replay debugger shows: `Recorded page stop <n> · <path>:<line>` with what is missing named, so a partial stop never reads like a moment without a stop.
 * @param stop - The pause.
 * @returns The thread label.
 * @example describeExtensionThread(stop) // => 'Recorded service worker stop 2 · worker.js:2'
 */
export function describeExtensionThread(
  stop: Pick<
    ExtensionReplayPause,
    'context' | 'stopIndex' | 'path' | 'line' | 'hasSnapshot' | 'hasSource'
  >,
): string {
  return `Recorded ${describeExtensionContext(stop.context)} stop ${stop.stopIndex} · ${stripTerminalControls(stop.path)}:${stop.line}${describeExtensionStopGap(stop)}`
}

/**
 * Words the label under the Application pane's frame: recorded, and for a stop whose frame was received earlier how long before the stop.
 * @param frame - What the moment shows.
 * @returns The label; the no-frame state for a moment with nothing recorded.
 * @example describeExtensionFrameLabel({ state: 'stream', frame, beforeStopMs: 1_234 }) // => 'Recorded frame from 1.2 s before this stop'
 */
export function describeExtensionFrameLabel(
  frame: ExtensionMomentFrame,
): string {
  if (frame.state === 'none') return NODE_EXTENSION_REPLAY_TEXT.noFrame
  if (frame.state === 'pinned') return 'Recorded frame captured at this stop'
  return frame.beforeStopMs === undefined
    ? 'Recorded frame'
    : `Recorded frame from ${(frame.beforeStopMs / 1_000).toFixed(1)} s before this stop`
}

/** Upper-cases the first letter of a phrase. @example capitalize('page stop 1') // => 'Page stop 1' */
function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/**
 * Words how a pause ended, so only a real continue reads as continued; called by {@link describeExtensionPosition}.
 * @param reason - The journal's close reason; absent reads as a continue.
 * @returns `continued`, `service worker lost`, `surface closed` or `run ended while paused`.
 * @example describeExtensionCloseReason('worker-lost') // => 'service worker lost'
 */
function describeExtensionCloseReason(
  reason: ExtensionPauseCloseReason | undefined,
): string {
  switch (reason) {
    case 'worker-lost':
      return 'service worker lost'
    case 'surface-lost':
      return 'surface closed'
    case 'run-ended':
      return 'run ended while paused'
    case 'continue':
    case undefined:
      return 'continued'
  }
}

/**
 * Words an event's locator for the Study section and the event list heading.
 * @param event - The event.
 * @param model - The replay model, for a stop's number and the result.
 * @returns `<Context> stop <n> · <t> s`, `<Context> stop <n> continued · <t> s` (or `run ended while paused`, `service worker lost`, `surface closed`), `Frame · <t> s` or `Result · <outcome> · <t> s`.
 * @example describeExtensionPosition(event, model) // => 'Page stop 1 · 0.42 s'
 */
export function describeExtensionPosition(
  event: ExtensionReplayEvent,
  model: Pick<ExtensionReplayModel, 'pauses' | 'result'>,
): string {
  const time = `${formatEventSeconds(event.timeMs)} s`
  const pause = event.pauseId ? model.pauses.get(event.pauseId) : undefined
  const stop = pause
    ? `${describeExtensionContext(pause.context)} stop ${pause.stopIndex}`
    : 'stop'
  switch (event.type) {
    case 'pause-open':
      return `${capitalize(stop)} · ${time}`
    case 'pause-close':
      return `${capitalize(stop)} ${describeExtensionCloseReason(event.closeReason)} · ${time}`
    case 'frame':
      return `${NODE_EXTENSION_REPLAY_TEXT.eventOutput} · ${time}`
    case 'result':
      return `${NODE_EXTENSION_REPLAY_TEXT.eventResult} · ${model.result?.outcome ?? 'unavailable'} · ${time}`
  }
}

/**
 * Words the action of a learning step that leads to an event, for the step's button in the summary.
 * @param event - The event the step's reference leads to.
 * @param model - The replay model, for a stop's number and context.
 * @returns `Inspect page stop 1 · 0.42 s` for a stop, `Inspect result · 1.20 s` for the result, `Inspect frame · 0.30 s` otherwise.
 * @example describeExtensionStepAction(event, model) // => 'Inspect page stop 1 · 0.42 s'
 */
export function describeExtensionStepAction(
  event: ExtensionReplayEvent,
  model: Pick<ExtensionReplayModel, 'pauses'>,
): string {
  const time = `${formatEventSeconds(event.timeMs)} s`
  const pause = event.pauseId ? model.pauses.get(event.pauseId) : undefined
  if (pause)
    return `Inspect ${describeExtensionContext(pause.context)} stop ${pause.stopIndex} · ${time}`
  return `Inspect ${event.type === 'result' ? 'result' : 'frame'} · ${time}`
}

/**
 * Words one event of the Study pane's event list: its heading and its body.
 * @param event - The event.
 * @param model - The replay model.
 * @returns The heading and the body.
 * @example describeExtensionEventRow(event, model) // => { heading: 'Page stop 1 · 0.42 s', body: 'popup.js:2' }
 */
export function describeExtensionEventRow(
  event: ExtensionReplayEvent,
  model: Pick<ExtensionReplayModel, 'pauses' | 'result'>,
): ExtensionReplayEventRow {
  const heading = describeExtensionPosition(event, model)
  const pause = event.pauseId ? model.pauses.get(event.pauseId) : undefined
  if (event.type === 'pause-open' && pause)
    return {
      heading,
      body: `${stripTerminalControls(pause.path)}:${pause.line}${describeExtensionStopGap(pause)}`,
    }
  if (event.type === 'frame' && event.frame)
    return { heading, body: `${event.frame.width} × ${event.frame.height} px` }
  if (event.type === 'result')
    return { heading, body: model.result?.cause ?? '' }
  return { heading, body: '' }
}

/**
 * Words the capture state of a history for the replay header and the Saved studies row.
 * @param summary - The history's summary.
 * @returns `recording`, `capture complete`, `capture partial`, `capture interrupted` or `unavailable`.
 * @example describeExtensionCaptureState(summary) // => 'capture complete'
 */
function describeExtensionCaptureState(
  summary: Pick<ExtensionHistorySummary, 'status' | 'verification'>,
): string {
  if (summary.verification === 'unavailable') return 'unavailable'
  return summary.status === 'recording'
    ? 'recording'
    : `capture ${summary.status}`
}

/**
 * Words a Saved studies row for an Extension replay: the question, the extension, the surface and the capture state; a history that cannot be opened names its reason.
 * @param summary - The history's summary.
 * @returns The row's outcome text.
 * @example describeExtensionReplayRow(summary) // => 'Why does Save fail? · Extension replay · Bookmark Notes 1.2.0 · popup · capture complete'
 */
export function describeExtensionReplayRow(
  summary: ExtensionHistorySummary,
): string {
  const state =
    summary.verification === 'unavailable'
      ? `unavailable${summary.reason ? `: ${summary.reason}` : ''}`
      : describeExtensionCaptureState(summary)
  return `${summary.question} · ${NODE_EXTENSION_REPLAY_TEXT.heading} · ${summary.extensionName} ${summary.extensionVersion} · ${summary.surfaceKind} · ${state}`
}
