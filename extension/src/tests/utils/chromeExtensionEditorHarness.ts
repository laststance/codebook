import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import type {
  ExtensionPhaseReporter,
  ExtensionStopContext,
} from '../../chromeExtensionContracts'
import type {
  ChromeExtensionDebugger,
  ExtensionDebuggerHandlers,
} from '../../chromeExtensionDebugger'
import * as realConstants from '../../constants'
import type { StudyError } from '../../errors'
import type * as DebuggerModule from '../../vscodeChromeExtensionDebugger'

import { loadModule } from './loadModule'
import { sourceBreakpointRequest } from './sourceBreakpointRequest'

/** The extension id every run of the harness loads. */
export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
export const SURFACE_TARGET = 'surface-target'
export const SURFACE_URL = `chrome-extension://${EXTENSION_ID}/popup.html`
export const WORKER_URL = `chrome-extension://${EXTENSION_ID}/service-worker.js`

/** Replacements for named limits of the constants module; a numeric limit takes any number, so a test can shorten a bound. */
export type ConstantOverrides = {
  [
    Key in keyof typeof realConstants
  ]?: (typeof realConstants)[Key] extends number
    ? number
    : (typeof realConstants)[Key]
}

/** One declared stop of a test, by its file and line. */
export type TestStop = {
  file: 'popup.js' | 'service-worker.js'
  line: number
  context: ExtensionStopContext
}

type FakeSession = vscode.DebugSession & {
  customRequest: (command: string, arguments_?: unknown) => Promise<unknown>
}

type FrameAt = { file: string; line: number }

/**
 * A fake editor with js-debug attach sessions behind it: a root session, page and service-worker child sessions with their own adapters, `setBreakpoints` requests and replies per session, stops, continues and output, through the real {@link OwnedRepositoryBreakpoint}, stop registry and debugger.
 * @param options.captureGate - Holds every snapshot capture until it settles.
 * @param options.constants - Replaces named limits of {@link realConstants} for the debugger under test only (short bounds and holds).
 * @example
 * const editor = await extensionEditorHarness()
 * const { debug } = editor.createDebugger([{ file: 'popup.js', line: 3, context: 'page' }])
 */
export async function extensionEditorHarness(
  options: {
    captureGate?: Promise<void>
    constants?: ConstantOverrides
  } = {},
) {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-ext-debugger-'))
  const contents: Record<string, string> = {
    'popup.js': 'one\ntwo\nthree\nfour\n',
    'service-worker.js': 'alpha\nbeta\ngamma\ndelta\n',
  }
  for (const [name, text] of Object.entries(contents))
    await writeFile(join(folder, name), text)
  const hashOf = (name: string): string =>
    createHash('sha256').update(contents[name]!).digest('hex')

  const requests: Array<{
    sessionId: string
    command: string
    arguments: unknown
  }> = []
  const started: Array<{
    configuration: vscode.DebugConfiguration
    options: vscode.DebugSessionOptions | undefined
  }> = []
  const stopped: string[] = []
  const trackers = new Map<string, vscode.DebugAdapterTracker>()
  const sessions = new Map<string, FakeSession>()
  const verifies = new Map<string, boolean>()
  const boundLines = new Map<string, number>()
  const frames = new Map<string, FrameAt>()
  const adapterIds = new Map<string, number>()
  let trackerFactory: vscode.DebugAdapterTrackerFactory | undefined
  let terminate: ((session: vscode.DebugSession) => void) | undefined
  let requestSequence = 100
  /** A stop each session's adapter reports right after it answers its next `continue`, by session id. */
  const stopsAfterContinue = new Map<string, () => void>()
  let nextAdapterId = 1
  let nextEditorBreakpointId = 0
  let captureCalls = 0
  let refuseContinues = false
  let stopDebuggingFailure: Error | undefined
  let startGate: Promise<void> | undefined

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
  class SourceBreakpoint {
    readonly id = String(++nextEditorBreakpointId)
    constructor(readonly location: Location) {}
  }
  const editorBreakpoints: SourceBreakpoint[] = []

  /** The adapter id one session gives one editor breakpoint; stable for the session. */
  const adapterIdOf = (sessionId: string, breakpoint: SourceBreakpoint) => {
    const key = `${sessionId}:${breakpoint.id}`
    if (!adapterIds.has(key)) adapterIds.set(key, nextAdapterId++)
    return adapterIds.get(key)!
  }

  const replyFor = (
    sessionId: string,
    breakpoint: SourceBreakpoint,
  ): DebugProtocol.Breakpoint => {
    const requested = breakpoint.location.range.start
    return {
      id: adapterIdOf(sessionId, breakpoint),
      verified: verifies.get(sessionId) ?? true,
      line: boundLines.get(sessionId) ?? requested.line + 1,
      column: requested.character + 1,
      source: { path: breakpoint.location.uri.fsPath },
    }
  }

  /** Passes the editor's replacement of every file's breakpoints, and the session's adapter replies, through its tracker. */
  const sendBreakpoints = (sessionId: string): void => {
    const tracker = trackers.get(sessionId)
    const files = [
      ...new Set(editorBreakpoints.map((entry) => entry.location.uri.fsPath)),
    ]
    for (const file of files) {
      const inFile = editorBreakpoints.filter(
        (entry) => entry.location.uri.fsPath === file,
      )
      const sequence = ++requestSequence
      tracker?.onWillReceiveMessage?.({
        type: 'request',
        seq: sequence,
        command: 'setBreakpoints',
        arguments: {
          source: { path: file },
          breakpoints: inFile.map((entry) =>
            sourceBreakpointRequest(entry.location.range.start),
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
          breakpoints: inFile.map((entry) => replyFor(sessionId, entry)),
        },
      })
    }
  }
  const sendBreakpointsToAll = (): void => {
    for (const id of trackers.keys()) queueMicrotask(() => sendBreakpoints(id))
  }

  const makeSession = (
    id: string,
    configuration: vscode.DebugConfiguration,
    parentSession?: vscode.DebugSession,
  ): FakeSession => {
    const session = {
      id,
      type: 'pwa-chrome',
      name: String(configuration.name),
      workspaceFolder: undefined,
      configuration,
      parentSession,
      getDebugProtocolBreakpoint: async () => undefined,
      async customRequest(command: string, arguments_?: unknown) {
        const tracker = trackers.get(id)
        const sequence = ++requestSequence
        tracker?.onWillReceiveMessage?.({
          type: 'request',
          seq: sequence,
          command,
          arguments: arguments_,
        })
        requests.push({ sessionId: id, command, arguments: arguments_ })
        if (command === 'continue') {
          tracker?.onDidSendMessage?.({
            type: 'response',
            seq: sequence + 1_000,
            request_seq: sequence,
            command,
            success: !refuseContinues,
            ...(refuseContinues
              ? { message: 'the adapter refused' }
              : { body: { allThreadsContinued: true } }),
          })
          if (refuseContinues) throw new Error('the adapter refused')
          // An adapter can report the thread's next stop right after its answer, before the editor's call returns.
          const nextStop = stopsAfterContinue.get(id)
          stopsAfterContinue.delete(id)
          nextStop?.()
        }
        if (command === 'stackTrace') {
          const frame = frames.get(id)
          return {
            stackFrames: frame
              ? [
                  {
                    id: 1,
                    name: 'handler',
                    line: frame.line,
                    column: 1,
                    source: { path: frame.file },
                  },
                ]
              : [],
          }
        }
        if (command === 'scopes')
          return { scopes: [{ name: 'Local', variablesReference: 1 }] }
        return {}
      },
    } as unknown as FakeSession
    sessions.set(id, session)
    return session
  }

  const editor = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Position,
    Location,
    SourceBreakpoint,
    workspace: {
      getWorkspaceFolder: () => undefined,
      textDocuments: [],
    },
    debug: {
      breakpoints: editorBreakpoints,
      addBreakpoints(added: SourceBreakpoint[]): void {
        editorBreakpoints.push(...added)
        sendBreakpointsToAll()
      },
      removeBreakpoints(removed: SourceBreakpoint[]): void {
        for (const breakpoint of removed) {
          const index = editorBreakpoints.indexOf(breakpoint)
          if (index >= 0) editorBreakpoints.splice(index, 1)
        }
        sendBreakpointsToAll()
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
        await startGate
        const root = makeSession('root-session', configuration)
        const tracker = await trackerFactory?.createDebugAdapterTracker(root)
        if (tracker) trackers.set(root.id, tracker)
        return true
      },
      async stopDebugging(session: FakeSession): Promise<void> {
        stopped.push(session.id)
        if (stopDebuggingFailure) throw stopDebuggingFailure
      },
    },
  }

  const breakpointModule = await loadModule<{
    OwnedRepositoryBreakpoint: unknown
  }>(resolve(__dirname, '../../ownedRepositoryBreakpoint.js'), {
    vscode: editor,
  })
  const registryModule = await loadModule<unknown>(
    resolve(__dirname, '../../chromeExtensionStopRegistry.js'),
    { vscode: editor, './ownedRepositoryBreakpoint': breakpointModule },
  )
  const module = await loadModule<typeof DebuggerModule>(
    resolve(__dirname, '../../vscodeChromeExtensionDebugger.js'),
    {
      vscode: editor,
      './constants': { ...realConstants, ...options.constants },
      './chromeExtensionStopRegistry': registryModule,
      './utils/captureReplayDebugSnapshot': {
        captureReplayDebugSnapshot: async () => {
          captureCalls += 1
          await options.captureGate
          return { version: 1, frames: [], variables: [], limitations: [] }
        },
      },
    },
  )

  let lastPageChild: FakeSession | undefined

  /** Adds a child session of the attach, as js-debug does for a target, and gives it the editor's current breakpoints. */
  const addChild = async (child: {
    kind: 'page' | 'service_worker'
    id: string
    title?: string
    /** The parent session; a page child defaults to the root, a worker child to the most recent page child (js-debug parents a worker under its page). */
    parent?: FakeSession
  }): Promise<FakeSession> => {
    const root = sessions.get('root-session')!
    const parent =
      child.parent ??
      (child.kind === 'service_worker' ? lastPageChild : undefined) ??
      root
    const session = makeSession(
      child.id,
      {
        type: 'pwa-chrome',
        request: 'attach',
        name: child.title ?? `child ${child.id}`,
        __browserTargetType: child.kind,
        // js-debug's own CDP session id of the attachment, never a target id (real js-debug 1.140).
        __pendingTargetId: `js-debug-session-${child.id}`,
        __parentId: parent.id,
      },
      parent,
    )
    if (child.kind === 'page') lastPageChild = session
    const tracker = await trackerFactory?.createDebugAdapterTracker(session)
    if (tracker) trackers.set(session.id, tracker)
    sendBreakpoints(session.id)
    return session
  }

  const adapter = {
    /** The adapter of a session reports a stop of a thread; with a frame, the stack answers it. */
    stop(
      session: FakeSession,
      reason: string,
      hitBreakpointIds?: number[],
      frame?: FrameAt,
      threadId = 1,
    ): void {
      if (frame) frames.set(session.id, frame)
      trackers.get(session.id)?.onDidSendMessage?.({
        type: 'event',
        event: 'stopped',
        body: {
          threadId,
          reason,
          ...(hitBreakpointIds ? { hitBreakpointIds } : {}),
        },
      })
    },
    /** The session's adapter reports this stop right after it answers the next `continue`, before the editor's `customRequest` returns, as js-debug can when the resumed code reaches the next breakpoint at once. */
    stopAfterContinue(
      session: FakeSession,
      reason: string,
      hitBreakpointIds: number[],
      frame: FrameAt,
    ): void {
      stopsAfterContinue.set(session.id, () =>
        adapter.stop(session, reason, hitBreakpointIds, frame),
      )
    },
    /** From now on the adapter answers every `continue` request with a refusal, which the editor reports as a rejected request. */
    refuseContinues(refuse: boolean): void {
      refuseContinues = refuse
    },
    /** The learner presses Continue in the session. */
    learnerContinues(session: FakeSession, threadId = 1): void {
      const tracker = trackers.get(session.id)
      const sequence = ++requestSequence
      tracker?.onWillReceiveMessage?.({
        type: 'request',
        seq: sequence,
        command: 'continue',
        arguments: { threadId },
      })
      tracker?.onDidSendMessage?.({
        type: 'response',
        seq: sequence + 1_000,
        request_seq: sequence,
        command: 'continue',
        success: true,
        body: { allThreadsContinued: false },
      })
    },
    /** The adapter reports a breakpoint verified or unverified again (a restarted worker). */
    breakpointNews(
      session: FakeSession,
      adapterId: number,
      verified: boolean,
      line = 3,
    ): void {
      trackers.get(session.id)?.onDidSendMessage?.({
        type: 'event',
        event: 'breakpoint',
        body: {
          reason: 'changed',
          breakpoint: {
            id: adapterId,
            verified,
            line,
            column: 1,
            source: { path: join(folder, 'service-worker.js') },
          },
        },
      })
    },
    /** The editor replaces the file's breakpoints, and the adapter has not answered yet. */
    replacementUnanswered(session: FakeSession, file: string): void {
      const inFile = editorBreakpoints.filter(
        (entry) => entry.location.uri.fsPath === join(folder, file),
      )
      trackers.get(session.id)?.onWillReceiveMessage?.({
        type: 'request',
        seq: ++requestSequence,
        command: 'setBreakpoints',
        arguments: {
          source: { path: join(folder, file) },
          breakpoints: inFile.map((entry) =>
            sourceBreakpointRequest(entry.location.range.start),
          ),
        },
      })
    },
    output(session: FakeSession, text: string, category = 'console'): void {
      trackers.get(session.id)?.onDidSendMessage?.({
        type: 'event',
        event: 'output',
        body: { category, output: text },
      })
    },
    end(session: FakeSession): void {
      sessions.delete(session.id)
      terminate?.(session)
    },
  }

  return {
    editor,
    adapter,
    addChild,
    folder,
    requests,
    started,
    stopped,
    editorBreakpoints,
    /** Holds every `startDebugging` call (before its session exists) until the test settles `gate`. */
    holdStartDebugging(gate: Promise<void>): void {
      startGate = gate
    },
    /** Makes the editor's `stopDebugging` reject with this error from now on. */
    failStopDebugging(error: Error): void {
      stopDebuggingFailure = error
    },
    /** Whether the debugger's tracker factory and termination listener are still registered. */
    listeners: () => ({
      tracker: trackerFactory !== undefined,
      termination: terminate !== undefined,
    }),
    captureCalls: () => captureCalls,
    session: (id: string) => sessions.get(id)!,
    /** The adapter id the session gave the editor breakpoint at a place. */
    adapterIdAt(session: FakeSession, file: string, line: number): number {
      const breakpoint = editorBreakpoints.find(
        (entry) =>
          entry.location.uri.fsPath === join(folder, file) &&
          entry.location.range.start.line === line - 1,
      )!
      return adapterIdOf(session.id, breakpoint)
    },
    /** Makes a session's adapter answer breakpoints as unverified from now on. */
    setVerified(session: FakeSession, verified: boolean): void {
      verifies.set(session.id, verified)
    },
    /** Makes a session's adapter bind every breakpoint on another line than requested. */
    setBoundLine(session: FakeSession, line: number): void {
      boundLines.set(session.id, line)
    },
    path: (name: string) => join(folder, name),
    async dispose(): Promise<void> {
      await rm(folder, { recursive: true, force: true })
    },
    /** Creates the debugger under test over the harness folder. */
    createDebugger(
      stops: TestStop[],
      overrides: {
        startWorker?: () => Promise<void>
        /** The browser's targets; defaults to the surface page and the extension's worker. */
        targets?: Array<{ targetId: string; type: string; url: string }>
        assertSourcesUnchanged?: () => void
        workerPath?: string
        onPhase?: ExtensionPhaseReporter
      } = {},
    ) {
      const events: Array<{ type: string; detail: unknown }> = []
      const failures: StudyError[] = []
      let changes = 0
      const handlers: ExtensionDebuggerHandlers = {
        onChange: () => {
          changes += 1
        },
        onFailure: (error) => failures.push(error),
      }
      const startWorkerCalls: number[] = []
      const debug: ChromeExtensionDebugger =
        module.createVscodeChromeExtensionDebugger({
          runId: 'run-3',
          workspace: folder,
          run: {
            root: folder,
            extensionId: EXTENSION_ID,
            surfaceUrl: SURFACE_URL,
            surface: { kind: 'popup', path: 'popup.html' },
            workerPath: overrides.workerPath ?? 'service-worker.js',
            stops: stops.map((stop, position) => ({
              index: position + 1,
              path: stop.file,
              absolutePath: join(folder, stop.file),
              line: stop.line,
              context: stop.context,
              sha256: hashOf(stop.file),
            })),
          },
          port: 9333,
          surfaceTargetId: SURFACE_TARGET,
          readTargets: async () =>
            overrides.targets ?? [
              { targetId: SURFACE_TARGET, type: 'page', url: SURFACE_URL },
              {
                targetId: 'worker-target',
                type: 'service_worker',
                url: WORKER_URL,
              },
            ],
          startWorker:
            overrides.startWorker ??
            (async (): Promise<void> => {
              startWorkerCalls.push(startWorkerCalls.length + 1)
            }),
          assertSourcesUnchanged:
            overrides.assertSourcesUnchanged ?? ((): void => {}),
          roots: { storage: [], workspace: [folder], home: ['/Users/ada'] },
          record: (type, detail) => events.push({ type, detail }),
          ...(overrides.onPhase !== undefined && {
            onPhase: overrides.onPhase,
          }),
        })
      debug.subscribe(handlers)
      return {
        debug,
        events,
        failures,
        changes: () => changes,
        startWorkerCalls,
      }
    },
  }
}
