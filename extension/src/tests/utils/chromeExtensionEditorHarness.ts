import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import type { ExtensionStopContext } from '../../chromeExtensionContracts'
import type {
  ChromeExtensionDebugger,
  ExtensionDebuggerHandlers,
} from '../../chromeExtensionDebugger'
import type { StudyError } from '../../errors'
import type * as DebuggerModule from '../../vscodeChromeExtensionDebugger'

import { loadModule } from './loadModule'
import { sourceBreakpointRequest } from './sourceBreakpointRequest'

/** The extension id every run of the harness loads. */
export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
export const SURFACE_TARGET = 'surface-target'
export const WORKER_TARGET = 'worker-target'
export const SURFACE_URL = `chrome-extension://${EXTENSION_ID}/popup.html`
export const WORKER_URL = `chrome-extension://${EXTENSION_ID}/service-worker.js`

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
 * @example
 * const editor = await extensionEditorHarness()
 * const { debug } = editor.createDebugger([{ file: 'popup.js', line: 3, context: 'page' }])
 */
export async function extensionEditorHarness(
  options: { captureGate?: Promise<void> } = {},
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
  let nextAdapterId = 1
  let nextEditorBreakpointId = 0
  let captureCalls = 0

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
        if (command === 'continue')
          tracker?.onDidSendMessage?.({
            type: 'response',
            seq: sequence + 1_000,
            request_seq: sequence,
            command,
            success: true,
            body: { allThreadsContinued: true },
          })
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
        const root = makeSession('root-session', configuration)
        const tracker = await trackerFactory?.createDebugAdapterTracker(root)
        if (tracker) trackers.set(root.id, tracker)
        return true
      },
      async stopDebugging(session: FakeSession): Promise<void> {
        stopped.push(session.id)
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

  /** Adds a child session of the attach, as js-debug does for a target, and gives it the editor's current breakpoints. */
  const addChild = async (child: {
    kind: 'page' | 'service_worker'
    targetId: string
    id: string
    title?: string
  }): Promise<FakeSession> => {
    const root = sessions.get('root-session')!
    const session = makeSession(
      child.id,
      {
        type: 'pwa-chrome',
        request: 'attach',
        name: child.title ?? `child ${child.id}`,
        __browserTargetType: child.kind,
        __pendingTargetId: child.targetId,
        __parentId: root.id,
      },
      root,
    )
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
        targetUrls?: Record<string, string>
        startWorker?: () => Promise<void>
        assertSourcesUnchanged?: () => void
        workerPath?: string
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
      const targetUrls = overrides.targetUrls ?? {
        [WORKER_TARGET]: WORKER_URL,
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
          targetUrlOf: async (targetId) => targetUrls[targetId],
          startWorker:
            overrides.startWorker ??
            (async (): Promise<void> => {
              startWorkerCalls.push(startWorkerCalls.length + 1)
            }),
          assertSourcesUnchanged:
            overrides.assertSourcesUnchanged ?? ((): void => {}),
          roots: { storage: [], workspace: [folder], home: ['/Users/ada'] },
          record: (type, detail) => events.push({ type, detail }),
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
