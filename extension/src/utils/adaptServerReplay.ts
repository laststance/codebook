import {
  NODE_TEST_FACT_PATH_LIMIT_CHARS,
  REPOSITORY_LITERAL_LIMIT_CHARS,
} from '../constants'
import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import type {
  ServerReplayEvent,
  ServerReplayModel,
} from './buildServerReplayModel'
import { findServerReplayTerminal } from './findServerReplayTerminal'
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
  const events = model.events.map((event) =>
    sanitizeServerReplayEvent(event, shownOutput),
  )
  const terminal = findServerReplayTerminal(events)
  return {
    ...model,
    events,
    ...(terminal ? { terminal } : {}),
    // The line names a path the script loaded; the pane prints it, so it loses terminal controls like every recorded text.
    ...(model.libraryLine === undefined
      ? {}
      : { libraryLine: stripTerminalControls(model.libraryLine) }),
  }
}

/**
 * Removes terminal and bidirectional controls from one recorded event of a server or script replay; called by {@link sanitizeServerReplayModel} for each event.
 * @param event - The recorded event.
 * @param shownOutput - Each output event's text as {@link stripOutputEntries} read its channel, by sequence.
 * @returns The event with every printed text stripped; hashes, lines, columns, snapshots and counts untouched.
 * @example sanitizeServerReplayEvent({ type: 'request', path: '/a\u202E', … }, shown) // => { type: 'request', path: '/a', … }
 */
function sanitizeServerReplayEvent(
  event: ServerReplayEvent,
  shownOutput: ReadonlyMap<number, string>,
): ServerReplayEvent {
  switch (event.type) {
    case 'output':
      return { ...event, text: shownOutput.get(event.sequence)! }
    case 'request':
      return { ...event, path: stripTerminalControls(event.path) }
    case 'sign-in':
      return {
        ...event,
        path: stripTerminalControls(event.path),
        ...(event.code === undefined
          ? {}
          : { code: stripTerminalControls(event.code) }),
      }
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
      return sanitizeResponseEvent(event)
    case 'request-failed':
      return {
        ...event,
        code: stripTerminalControls(event.code),
        message: stripTerminalControls(event.message),
      }
    case 'end':
      return sanitizeEndEvent(event)
  }
}

/**
 * Strips a recorded response's printed texts; called by {@link sanitizeServerReplayEvent}.
 * @param event - The recorded response.
 * @returns The response with its content type, body and location stripped, `null` kept as `null`.
 * @example sanitizeResponseEvent({ type: 'response', body: 'ok\u202E', contentType: null, location: null, … }) // => { …, body: 'ok' }
 */
function sanitizeResponseEvent(
  event: Extract<ServerReplayEvent, { type: 'response' }>,
): ServerReplayEvent {
  return {
    ...event,
    contentType:
      event.contentType === null
        ? null
        : stripTerminalControls(event.contentType),
    body: stripTerminalControls(event.body),
    location:
      event.location === null ? null : stripTerminalControls(event.location),
  }
}

/**
 * Strips a script end's printed texts (its signal and the reason its exit code is unknown); called by {@link sanitizeServerReplayEvent}.
 * @param event - The recorded end of a script run.
 * @returns The end with those texts stripped; fields it lacks stay absent.
 * @example sanitizeEndEvent({ type: 'end', kind: 'signal', signal: 'SIGTERM', … }) // => same end
 */
function sanitizeEndEvent(
  event: Extract<ServerReplayEvent, { type: 'end' }>,
): ServerReplayEvent {
  return {
    ...event,
    ...(event.signal ? { signal: stripTerminalControls(event.signal) } : {}),
    ...(event.exitUnknown
      ? { exitUnknown: stripTerminalControls(event.exitUnknown) }
      : {}),
  }
}

type TestShapedFacts = Extract<TestShapedEntry, { type: 'stop' }>['facts']

/**
 * Reads the mode of a server fact key (`value:<path>` or `type:<path>`); called by {@link toTestShapedFacts} for each recorded fact.
 * @param key - The recorded fact key.
 * @returns `'value'`, `'type'`, or `undefined` for a key without a known mode.
 * @example recordedFactMode('value:req.url') // => 'value'
 */
function recordedFactMode(key: string): 'value' | 'type' | undefined {
  if (key.startsWith('value:')) return 'value'
  if (key.startsWith('type:')) return 'type'
  return undefined
}

/**
 * Turns a server stop's recorded facts (a record keyed `<mode>:<path>`, written by the server history sink) into the fact list the shared replay path hands the native debugger, in recorded order; called by {@link toTestShapedHistory}.
 * @param facts - The stop's recorded facts; a key without a known `value:` or `type:` mode is skipped, never guessed.
 * @returns One fact per readable key; a displayed value that is not text is shown as its JSON.
 * @example toTestShapedFacts({ 'value:req.url': '/a' }) // => [{ path: 'req.url', mode: 'value', display: '/a' }]
 */
function toTestShapedFacts(facts: Record<string, unknown>): TestShapedFacts {
  return Object.entries(facts).flatMap(([key, value]) => {
    const mode = recordedFactMode(key)
    if (!mode) return []
    const path = stripTerminalControls(key.slice(mode.length + 1))
    const display = stripTerminalControls(
      typeof value === 'string' ? value : JSON.stringify(value),
    )
    // A fact the shared test fact schema refuses (empty or over-long path, over-long display) is skipped, never truncated.
    if (
      path.length === 0 ||
      path.length > NODE_TEST_FACT_PATH_LIMIT_CHARS ||
      display.length > REPOSITORY_LITERAL_LIMIT_CHARS
    )
      return []
    return [{ path, mode, display }]
  })
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
        facts: toTestShapedFacts(event.facts),
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
      configuration: {
        testFile: stripTerminalControls(
          header.declaredStops[0]?.path ??
            (header.profile === 'node-script' ? 'script' : 'server'),
        ),
      },
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
