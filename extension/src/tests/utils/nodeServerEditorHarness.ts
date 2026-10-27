import { resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import type { NodeServerDebuggerInput } from '../../nodeServerDebugger'
import type * as DebuggerModule from '../../vscodeNodeServerDebugger'

import { loadModule } from './loadModule'
import { sourceBreakpointRequest } from './sourceBreakpointRequest'

/** The repository root of the editor harness; no file is read from it. */
export const EDITOR_WORKSPACE = '/repo-of-the-editor-test'
/** The file both declared stops lie in. */
export const STOP_FILE = `${EDITOR_WORKSPACE}/src/routes/users.ts`
/** The adapter's DAP ids for the two owned breakpoints, in the order they are armed. */
export const OWNED_IDS = [7, 8]
/** A breakpoint the learner set in the editor. */
export const LEARNER_BREAKPOINT_ID = 12

type FrameAt = { file: string; line: number; column?: number }

/**
 * A fake editor with a `pwa-node` adapter behind it: sessions, the DAP tracker, `setBreakpoints` requests and replies for the breakpoints the editor holds, stops and continues. It loads the real {@link OwnedRepositoryBreakpoint} and the debugger under test.
 * @param options.verifiedLine - The line the adapter verifies the breakpoints on when it differs from the requested one.
 * @param options.stopFailures - How many first `stopDebugging` calls the editor rejects.
 * @param options.documents - The editor's open documents.
 * @example
 * const editor = await editorHarness(); const debug = editor.debug({ stops }); await debug.attach(...)
 */
export async function editorHarness(
  options: {
    verifiedLine?: number
    /** The first stop the adapter reports after the attach, in place of the entry pause. */
    firstStop?: { reason: string; ids?: number[]; frame?: FrameAt }
    stopFailures?: number
    /** The adapter rejects the stack trace of a pause after the entry pause. */
    stackTraceFails?: boolean
    documents?: Array<{
      uri: { scheme: string; fsPath: string }
      getText: () => string
    }>
  } = {},
) {
  const calls: string[] = []
  const requests: Array<{ command: string; arguments: unknown }> = []
  const started: Array<{
    configuration: vscode.DebugConfiguration
    options: vscode.DebugSessionOptions | undefined
  }> = []
  const bindings: Array<{
    name: string | undefined
    workingDirectory: string
  }> = []
  let tracker: vscode.DebugAdapterTracker | undefined
  let trackerFactory: vscode.DebugAdapterTrackerFactory | undefined
  let terminate: ((session: vscode.DebugSession) => void) | undefined
  let stopRequests = 0
  let requestSequence = 100
  let currentFrame: FrameAt | undefined
  // The file the declared stops lie in; a test that captures names a real one.
  let sourceFile = STOP_FILE
  class Position {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  }
  class Location {
    readonly range
    constructor(
      readonly uri: { fsPath: string },
      start: Position,
    ) {
      this.range = { start }
    }
  }
  let nextEditorBreakpointId = 0
  class SourceBreakpoint {
    readonly id = String(++nextEditorBreakpointId)
    constructor(readonly location: Location) {}
  }
  const editorBreakpoints: SourceBreakpoint[] = []
  const adapterReplies = new Map<SourceBreakpoint, DebugProtocol.Breakpoint>()
  let armed = 0
  // The entry pause is read normally; the pauses after it fail when asked.
  let entryDone = false
  /** Passes the editor's replacement of the file's breakpoints, and the adapter's reply, through the debugger's tracker. */
  const replaceBreakpoints = (): void => {
    const sequence = ++requestSequence
    tracker?.onWillReceiveMessage?.({
      type: 'request',
      seq: sequence,
      command: 'setBreakpoints',
      arguments: {
        source: { path: sourceFile },
        breakpoints: editorBreakpoints.map((breakpoint) =>
          sourceBreakpointRequest(breakpoint.location.range.start),
        ),
      },
    })
    tracker?.onDidSendMessage?.({
      type: 'response',
      seq: sequence + 1_000,
      request_seq: sequence,
      command: 'setBreakpoints',
      success: true,
      body: {
        breakpoints: editorBreakpoints.map((breakpoint) =>
          adapterReplies.get(breakpoint)!,
        ),
      },
    })
  }
  const session = {
    id: 'node-server-session',
    type: 'pwa-node',
    name: '',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-node', name: '', request: 'attach' },
    getDebugProtocolBreakpoint: async (breakpoint: unknown) =>
      editorBreakpoints.find((candidate) => candidate === breakpoint) &&
      adapterReplies.get(breakpoint as SourceBreakpoint),
    async customRequest(
      command: string,
      arguments_?: unknown,
    ): Promise<unknown> {
      // The editor passes Codebook's own requests through the same tracker as the learner's.
      tracker?.onWillReceiveMessage?.({
        type: 'request',
        seq: ++requestSequence,
        command,
        arguments: arguments_,
      })
      requests.push({ command, arguments: arguments_ })
      if (command === 'continue') entryDone = true
      if (command === 'stackTrace' && options.stackTraceFails && entryDone)
        throw new Error('stackTrace timed out')
      if (command === 'stackTrace')
        return {
          stackFrames: currentFrame
            ? [
                {
                  id: 1,
                  name: 'getUser',
                  line: currentFrame.line,
                  column: currentFrame.column ?? 3,
                  source: { path: currentFrame.file },
                },
              ]
            : [],
        } satisfies DebugProtocol.StackTraceResponse['body']
      if (command === 'scopes')
        return {
          scopes: [{ name: 'Local', variablesReference: 1, expensive: false }],
        } satisfies DebugProtocol.ScopesResponse['body']
      return {}
    },
  }
  const editor = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Position,
    Location,
    SourceBreakpoint,
    workspace: {
      getWorkspaceFolder: () => undefined,
      textDocuments: options.documents ?? [],
    },
    debug: {
      breakpoints: editorBreakpoints,
      addBreakpoints(added: SourceBreakpoint[]): void {
        calls.push('addBreakpoints')
        for (const breakpoint of added) {
          const id = OWNED_IDS[armed++]!
          const requested = breakpoint.location.range.start
          adapterReplies.set(breakpoint, {
            id,
            verified: true,
            line: options.verifiedLine ?? requested.line + 1,
            column: requested.character + 1,
          })
          editorBreakpoints.push(breakpoint)
        }
        if (tracker) queueMicrotask(replaceBreakpoints)
      },
      removeBreakpoints(removed: SourceBreakpoint[]): void {
        calls.push('removeBreakpoints')
        for (const breakpoint of removed) {
          const index = editorBreakpoints.indexOf(breakpoint)
          if (index >= 0) editorBreakpoints.splice(index, 1)
        }
        if (tracker) queueMicrotask(replaceBreakpoints)
      },
      registerDebugAdapterTrackerFactory(
        _type: string,
        factory: vscode.DebugAdapterTrackerFactory,
      ) {
        trackerFactory = factory
        return {
          dispose(): void {
            if (trackerFactory === factory) trackerFactory = undefined
          },
        }
      },
      onDidTerminateDebugSession: (
        listener: (ended: vscode.DebugSession) => void,
      ) => {
        terminate = listener
        return {
          dispose(): void {
            if (terminate === listener) terminate = undefined
          },
        }
      },
      async startDebugging(
        _folder: unknown,
        configuration: vscode.DebugConfiguration,
        startOptions?: vscode.DebugSessionOptions,
      ) {
        started.push({ configuration, options: startOptions })
        session.name = configuration.name
        session.configuration = {
          ...session.configuration,
          name: configuration.name,
        }
        tracker =
          (await trackerFactory?.createDebugAdapterTracker(session)) ??
          undefined
        queueMicrotask(() =>
          options.firstStop
            ? adapter.stop(
                options.firstStop.reason,
                options.firstStop.ids,
                options.firstStop.frame,
              )
            : adapter.stop('entry'),
        )
        return true
      },
      async stopDebugging(): Promise<void> {
        calls.push('stopDebugging')
        stopRequests += 1
        if (stopRequests <= (options.stopFailures ?? 0))
          throw new Error(`the adapter did not answer (stop ${stopRequests})`)
      },
    },
  }
  const breakpointModule = await loadModule<{
    OwnedRepositoryBreakpoint: unknown
    OwnedBreakpointMovedError: unknown
  }>(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), {
    vscode: editor,
  })
  const module = await loadModule<typeof DebuggerModule>(
    resolve(__dirname, '../../vscodeNodeServerDebugger.js'),
    {
      vscode: editor,
      './ownedRepositoryBreakpoint': breakpointModule,
      './utils/bindOwnedNodeTestDebugSession': {
        bindOwnedNodeTestDebugSession: async (
          bound: vscode.DebugSession,
          _runId: string,
          workingDirectory: string,
          processGroup: number,
          _signal: AbortSignal,
          _assertActive: unknown,
          name?: string,
        ) => {
          bindings.push({ name, workingDirectory })
          return {
            session: bound,
            identity: {
              pid: processGroup,
              processGroup,
              workspace: workingDirectory,
            },
            cdp: { close(): void {} },
          }
        },
      },
      './utils/inspectNodeTestVariables': {
        inspectNodeTestVariables: async () => ({
          variables: [],
          facts: [
            { path: 'user.id', mode: 'value', display: '7', type: 'number' },
          ],
          unavailable: [],
        }),
      },
      './utils/captureReplayDebugSnapshot': {
        captureReplayDebugSnapshot: async () => ({
          version: 1,
          frames: [],
          variables: [],
          limitations: [],
        }),
      },
    },
  )
  /** The adapter's side: stops and the learner's resume. */
  const adapter = {
    /** The adapter reports a stop of the thread; with a frame, the stack answers it. */
    stop(reason: string, hitBreakpointIds?: number[], frame?: FrameAt): void {
      currentFrame = frame
      tracker?.onDidSendMessage?.({
        type: 'event',
        event: 'stopped',
        body: {
          threadId: 1,
          reason,
          ...(hitBreakpointIds ? { hitBreakpointIds } : {}),
        },
      })
    },
    /** The learner presses Continue: the editor's request reaches the adapter. */
    learnerContinues(): void {
      tracker?.onWillReceiveMessage?.({
        type: 'request',
        seq: ++requestSequence,
        command: 'continue',
        arguments: { threadId: 1 },
      })
    },
    /** The editor ends the session. */
    end(): void {
      terminate?.(session)
    },
  }
  return {
    module,
    editor,
    adapter,
    calls,
    requests,
    started,
    bindings,
    editorBreakpoints,
    session,
    /** Creates the debugger under test. */
    createDebugger(
      stops: Array<{ line: number; column: number }>,
      source: { file: string; hash: string; workspace: string } = {
        file: STOP_FILE,
        hash: 'a'.repeat(64),
        workspace: EDITOR_WORKSPACE,
      },
      citedSources: NodeServerDebuggerInput['citedSources'] = [],
    ) {
      sourceFile = source.file
      const events: Array<{ type: string; detail: unknown }> = []
      const debug = module.createVscodeNodeServerDebugger({
        runId: 'run-9',
        workspace: source.workspace,
        citedSources,
        stops: stops.map((stop, declaredStopIndex) => ({
          declaredStopIndex,
          path: 'src/routes/users.ts',
          file: source.file,
          line: stop.line,
          column: stop.column,
          hash: source.hash,
          inspections: [],
        })),
        record: (type, detail) => events.push({ type, detail }),
      })
      return { debug, events }
    },
  }
}
