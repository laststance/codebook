import type { ExtensionHistoryTypes } from '../chromeExtensionHistoryTypes'
import type { HistoryIndexOf } from '../historyStorageDescriptor'
import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import {
  buildExtensionReplayModel,
  type ExtensionReplayModel,
  type ExtensionReplayMoment,
  type ExtensionReplayPause,
} from './buildExtensionReplayModel'
import { stripTerminalControls } from './stripTerminalControls'

type TestShapedEntry = NodeTestHistoryIndex['entries'][number]
/** A test-shaped stop entry, the shape the workspace's select, source slot and debugger path know. */
export type ExtensionTestShapedStop = Extract<TestShapedEntry, { type: 'stop' }>

/**
 * An Extension replay as the Study workspace presents it: the replay model and an in-memory test-shaped history that the workspace's select, supersede and commit order moves over unchanged.
 * Made once per opened history by {@link adaptExtensionReplay}; it holds data only, so a replay never reaches Chrome or a debugger launcher.
 */
export type ExtensionReplayPresentation = {
  model: ExtensionReplayModel
  /** Every event as a test-shaped entry: a pause-open is a `stop`, the rest are non-stop `result` entries. Its order is the timeline's. */
  history: NodeTestHistoryIndex
  /** The same entries as the surfaces print them (paths free of terminal controls). */
  shown: NodeTestHistoryIndex
  /** The stop entry each pause presents, by pause id, with its source verified exactly as a test stop's is. */
  stopEntries: ReadonlyMap<string, ExtensionTestShapedStop>
  /** Finds the timeline event a learning citation leads to: an event cited by its own sequence, a capture by its pause's open; `undefined` for a sequence the timeline lacks. */
  timelineSequenceOf: (sequence: number) => number | undefined
  /** Why the capture is partial or interrupted, every reason, for the replay's capture-reason line. */
  captureReasons: readonly string[]
}

/** The debugger snapshot of a stop with none recorded: no frames, so no source verifies. */
const EMPTY_SNAPSHOT: ExtensionTestShapedStop['debuggerSnapshot'] = {
  version: 1,
  frames: [],
  variables: [],
  limitations: [],
}

/**
 * Dresses a pause as the stop entry the workspace presents: the capture's snapshot and source place, or an empty snapshot for a stop that was not captured. It sits at the pause's open on the timeline.
 * @param pause - The recorded pause.
 * @param strip - Whether to strip terminal controls from texts printed on surfaces.
 * @returns The test-shaped stop.
 * @example toStopEntry(pause, false).index // => 0 for the first declared stop
 */
function toStopEntry(
  pause: ExtensionReplayPause,
  strip: boolean,
): ExtensionTestShapedStop {
  const path = strip ? stripTerminalControls(pause.path) : pause.path
  return {
    type: 'stop',
    sequence: pause.openSequence,
    elapsedMs: pause.openMs,
    index: pause.stopIndex - 1,
    source: {
      path,
      hash: pause.capture?.sourceHash ?? '0'.repeat(64),
      line: pause.line,
      column: pause.capture?.debuggerSnapshot.frames[0]?.column ?? 1,
    },
    frame: {
      name: pause.capture?.debuggerSnapshot.frames[0]?.name ?? '',
      line: pause.line,
      column: pause.capture?.debuggerSnapshot.frames[0]?.column ?? 1,
    },
    // The extension run records no inspections apart from the snapshot's own scopes.
    facts: [],
    debuggerSnapshot: pause.capture?.debuggerSnapshot ?? EMPTY_SNAPSHOT,
  }
}

/**
 * Maps the model's events onto the entry types the workspace's replay path knows: a pause-open keeps its stop, every other event is a non-stop moment (a `result` entry with no exit code), which every surface treats as a moment without a source line.
 * @param model - The replay model.
 * @param stops - The stop entry of each pause.
 * @returns The test-shaped history in timeline order.
 * @example toTestShapedHistory(model, stops).entries.map((entry) => entry.type) // => ['result', 'stop', 'result']
 */
function toTestShapedHistory(
  model: ExtensionReplayModel,
  stops: ReadonlyMap<string, ExtensionTestShapedStop>,
  strip: boolean,
): NodeTestHistoryIndex {
  const entries = model.events.map((event): TestShapedEntry => {
    const stop = event.pauseId ? stops.get(event.pauseId) : undefined
    if (event.type === 'pause-open' && stop) return stop
    return {
      type: 'result',
      sequence: event.sequence,
      elapsedMs: event.timeMs,
      exitCode: null,
      signal: null,
      outputTail: '',
    }
  })
  const { header } = model
  const surface = strip
    ? stripTerminalControls(header.surface.path)
    : header.surface.path
  // The one place an extension replay is dressed as a test history: only the fields the shared path reads exist.
  return {
    header: {
      workspaceKey: header.workspaceKey,
      studyId: header.studyId,
      instanceId: header.instanceId,
      runId: header.runId,
      createdAt: header.createdAt,
      configuration: { testFile: surface },
    },
    entries,
    status: model.status,
  } as unknown as NodeTestHistoryIndex
}

/**
 * Words the reasons an extension capture is partial or interrupted, from its seal or the store's reason for an unsealed history.
 * @param history - The verified history.
 * @returns The reasons in the seal's own words.
 * @example extensionCaptureReasons(history) // => ['The surface closed during the run.']
 */
function extensionCaptureReasons(
  history: Pick<HistoryIndexOf<ExtensionHistoryTypes>, 'seal' | 'reason'>,
): string[] {
  if (history.seal) return history.seal.reasons.map((reason) => reason.text)
  return history.reason ? [history.reason] : []
}

/**
 * Presents a verified chrome-extension history through the workspace's replay path: the model, its test-shaped history and display copy, and every stop entry by pause. Called once per opened Extension replay by the Study workspace.
 * @param history - The history the extension store read.
 * @returns The presentation.
 * @example const replay = adaptExtensionReplay(await store.read(studyId))
 */
export function adaptExtensionReplay(
  history: HistoryIndexOf<ExtensionHistoryTypes>,
): ExtensionReplayPresentation {
  const model = buildExtensionReplayModel(history)
  const stopEntries = new Map(
    [...model.pauses.values()].map((pause) => [
      pause.pauseId,
      toStopEntry(pause, false),
    ]),
  )
  const shownStops = new Map(
    [...model.pauses.values()].map((pause) => [
      pause.pauseId,
      toStopEntry(pause, true),
    ]),
  )
  // A capture is not an event: a step citing it leads to the open of its pause.
  const openOfCapture = new Map(
    [...model.pauses.values()].flatMap((pause) =>
      pause.capture
        ? [[pause.capture.sequence, pause.openSequence] as const]
        : [],
    ),
  )
  return {
    model,
    timelineSequenceOf: (sequence) =>
      model.indexBySequence.has(sequence)
        ? sequence
        : openOfCapture.get(sequence),
    history: toTestShapedHistory(model, stopEntries, false),
    shown: toTestShapedHistory(model, shownStops, true),
    stopEntries,
    captureReasons: extensionCaptureReasons(history),
  }
}

/**
 * Names what a moment makes the native surfaces show, so the workspace repaints the debugger and the source slot only when it changes: the selected stop and what of it is recorded. A frame event between such changes only changes the Application frame.
 * @param moment - The moment at an event.
 * @returns A key equal for two moments with the same native presentation.
 * @example extensionNativeKey(moment) // => 'p1:true:true' at a complete stop, 'none' with no stop
 */
export function extensionNativeKey(moment: ExtensionReplayMoment): string {
  const stop = moment.stop
  return stop ? `${stop.pauseId}:${stop.hasSnapshot}:${stop.hasSource}` : 'none'
}
