import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import type {
  ServerReplayEvent,
  ServerReplayModel,
} from './buildServerReplayModel'
import {
  indexNodeTestOutput,
  stripOutputEntries,
  type NodeTestOutputIndex,
} from './indexNodeTestOutput'
import { stripTerminalControls } from './stripTerminalControls'

type TestShapedEntry = NodeTestHistoryIndex['entries'][number]

/**
 * A server replay as the Study workspace presents it: the replay model, an in-memory test-shaped history that the workspace's select, supersede and commit order moves over unchanged, the same two with every text free of terminal controls for display, and the output read once.
 * Made once per opened history by {@link adaptServerReplay}; it holds data only, so a replay never reaches the launcher or the HTTP sender.
 */
export type ServerReplayPresentation = {
  /** The model as the store read it; the host verifies a stop against it. */
  model: ServerReplayModel
  /** The model with every recorded text free of terminal and bidirectional controls; the surfaces print it. */
  shownModel: ServerReplayModel
  /** The learner events as test-shaped entries (stop, output, and `result` for the request, the response and the failure); read by the workspace's shared selection path. */
  history: NodeTestHistoryIndex
  /** The same entries as the surfaces print them. */
  shown: NodeTestHistoryIndex
  /** The shown output read once ({@link indexNodeTestOutput}). */
  outputIndex: NodeTestOutputIndex
  /** Why the capture is partial or interrupted, every reason, for the replay's capture-reason line. */
  captureReasons: readonly string[]
  /** The reason, in a replay's words, that the history was recorded with no response; absent when it holds none (a recorded answer, or only a partial reason about stops or writing). */
  noResponseReason?: string
}

/**
 * Removes terminal and bidirectional controls from every recorded text of a server replay that a surface prints, as the test replay does for its own: output is read as one stream per channel, and a request path, a response body, a failure code and a stop's path and frame name each lose them. Hashes, lines, columns, snapshots and counts are untouched.
 * @param model - The replay model as the store read it.
 * @returns A model whose events print safely; the input is not changed.
 * @example sanitizeServerReplayModel(model).events[1] // => { type: 'output', text: 'ok\n', … } for a recorded 'o\u202Ek\n'
 */
function sanitizeServerReplayModel(
  model: ServerReplayModel,
): ServerReplayModel {
  const shownOutput = stripOutputEntries(model.events)
  const events = model.events.map((event): ServerReplayEvent => {
    switch (event.type) {
      case 'output':
        return { ...event, text: shownOutput.get(event.sequence)! }
      case 'request':
        return { ...event, path: stripTerminalControls(event.path) }
      case 'request-withdrawn':
        return { ...event, code: stripTerminalControls(event.code) }
      case 'stop':
        return {
          ...event,
          source: {
            ...event.source,
            path: stripTerminalControls(event.source.path),
          },
          frame: { name: stripTerminalControls(event.frame.name) },
        }
      case 'response':
        return {
          ...event,
          contentType:
            event.contentType === null
              ? null
              : stripTerminalControls(event.contentType),
          body: stripTerminalControls(event.body),
          location:
            event.location === null
              ? null
              : stripTerminalControls(event.location),
        }
      case 'request-failed':
        return {
          ...event,
          code: stripTerminalControls(event.code),
          message: stripTerminalControls(event.message),
        }
    }
  })
  const terminal = events.find(
    (event) => event.type === 'response' || event.type === 'request-failed',
  )
  return {
    ...model,
    events,
    ...(terminal?.type === 'response' || terminal?.type === 'request-failed'
      ? { terminal }
      : {}),
  }
}

/**
 * Maps a model's learner events onto the entry types the workspace's replay path knows: a stop keeps its snapshot and position, an output keeps its channel and text, and the request, the withdrawal, the response and the failure are non-stop moments (`result` entries with no exit code), which every surface treats as the 4A moments they are.
 * Called by {@link adaptServerReplay} for the stored model and for the shown one.
 * @param model - The replay model.
 * @returns The test-shaped history: a minimal header (study id, creation time and the first declared stop's file for the placeholder slot's name), the entries, the status.
 * @example toTestShapedHistory(model).entries.map((entry) => entry.type) // => ['result', 'stop', 'output', 'result']
 */
function toTestShapedHistory(model: ServerReplayModel): NodeTestHistoryIndex {
  let outputSequence = 0
  const entries = model.events.map((event): TestShapedEntry => {
    const base = { sequence: event.sequence, elapsedMs: event.elapsedMs }
    if (event.type === 'output')
      return {
        type: 'output',
        ...base,
        outputSequence: ++outputSequence,
        channel: event.channel,
        text: event.text,
      }
    if (event.type === 'stop')
      return {
        type: 'stop',
        ...base,
        index: event.declaredStopIndex,
        source: event.source,
        frame: {
          name: event.frame.name,
          line: event.source.line,
          column: event.source.column,
        },
        facts: [],
        debuggerSnapshot: event.debuggerSnapshot,
      }
    return {
      type: 'result',
      ...base,
      exitCode: null,
      signal: null,
      outputTail: '',
    }
  })
  const { header } = model
  // The one place a server replay is dressed as a test history: only the fields the shared path reads exist.
  return {
    header: {
      workspaceKey: header.workspaceKey,
      studyId: header.studyId,
      instanceId: header.instanceId,
      runId: header.runId,
      createdAt: header.createdAt,
      configuration: { testFile: header.declaredStops[0]?.path ?? 'server' },
    },
    entries,
    status: model.status,
  } as unknown as NodeTestHistoryIndex
}

/**
 * Presents a server replay model through the workspace's test replay path: the test-shaped history the selection moves over, its display copy with controls stripped, the model's own display copy and the output read once.
 * Called once per opened server history by the Study workspace.
 * @param model - The replay model {@link buildServerReplayModel} made.
 * @param captureReasons - Every reason the capture is partial or interrupted, worded.
 * @param noResponseReason - The worded no-response reason among them, when the history has one.
 * @returns The presentation.
 * @example const replay = adaptServerReplay(model, []); replay.history.entries[0]?.type // => 'result' for the request
 */
export function adaptServerReplay(
  model: ServerReplayModel,
  captureReasons: readonly string[],
  noResponseReason?: string,
): ServerReplayPresentation {
  const shownModel = sanitizeServerReplayModel(model)
  const shown = toTestShapedHistory(shownModel)
  return {
    model,
    shownModel,
    history: toTestShapedHistory(model),
    shown,
    outputIndex: indexNodeTestOutput(shown.entries),
    captureReasons,
    ...(noResponseReason ? { noResponseReason } : {}),
  }
}
