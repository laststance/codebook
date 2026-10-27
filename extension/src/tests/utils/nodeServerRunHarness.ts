import type { ConfiguredDescriptor } from '../../configuredStudySchemas'
import type { StudyError } from '../../errors'
import type { NodeServerConfiguration } from '../../nodeServerConfigSchemas'
import type {
  NodeServerArmedStop,
  NodeServerDebugger,
  NodeServerDebuggerHandlers,
  NodeServerDebuggerInput,
  NodeServerDebuggerPause,
  NodeServerStopCapture,
  NodeServerStopTarget,
} from '../../nodeServerDebugger'
import {
  createOwnedNodeServerRun,
  type NodeServerRunDependencies,
} from '../../ownedNodeServerRun'
import type { NodeServerResponse, NodeServerRuntime } from '../../runtime'
import type {
  NodeServerCloseOptions,
  NodeServerExit,
} from '../../utils/launchNodeServer'

import { createManualClock } from './createManualClock'
import { defer } from './defer'

/** The repository root every host test of the run uses; no file is read from it. */
export const WORKSPACE = '/repo-of-the-run-test'

let nextPort = 41_200

/** A declared port nobody else in this test process uses, since port claims live for the process. */
export function uniquePort(): number {
  return nextPort++
}

/** What a test arranges beyond the happy path. */
export type HarnessOptions = {
  /** Declared stops: one (the source) by default; two puts a second stop in the same file. */
  stops?: 1 | 2
  /** The declared port; a unique one by default. */
  port?: number
  sourcesChanged?: StudyError
  attachFails?: Error
  armFails?: Error
  /** Runs inside the debugger's entry release, to emit pauses before readiness. */
  duringRelease?: (debug: FakeNodeServerDebugger) => void
  resolveLaunchFails?: StudyError
  portTaken?: StudyError
  listener?: Awaited<ReturnType<NodeServerRunDependencies['verifyListener']>>
  /** Replaces the readiness wait; it gets the run's input. */
  waitForReadiness?: NodeServerRunDependencies['waitForReadiness']
  /** Answers the server's inspector endpoint in place of the fake's at once, so a test can hold the run before it reads its leader. */
  inspectorEndpoint?: (signal?: AbortSignal) => Promise<string>
  listeningPorts?: number[]
  /** The real debugger reports `onResume` when the editor's continue request is sent, before the adapter answers. */
  resumeEmitsOnResume?: boolean
  /** The adapter rejects the continue request. */
  resumeFails?: Error
  /** The request sender throws synchronously. */
  sendThrows?: Error
  /** Holds the answer of the port-occupant lookup until the test settles it. */
  occupantGate?: Promise<void>
  /** The server's last output, as it prints before it exits. */
  serverOutput?: string
  /** The pids that hold the server end of the request's connection; the launched server by default. */
  connectionHolders?: number[]
  /** Holds the request's peer check (which process holds the connection) until the test settles it. */
  peerCheckGate?: Promise<void>
  inspectorPort?: number
  /** The server ends the close call by hand: the test settles `closeGate`. */
  holdClose?: boolean
  occupant?: { pid: number; command?: string }
  groupGone?: boolean
  /** The leader's start as each successive read answers it, before the reads fall back to the harness's `leader.start`; `undefined` is a read that failed. */
  leaderStartReads?: Array<string | undefined>
  /** What the pid probe answers for the launched leader's id; a process still has it unless a test says otherwise. */
  processGone?: boolean
  /** Also receives every event the run journals, as the service's record does when the service owns the run. */
  record?: (type: string, detail?: unknown) => unknown
  /** The run id the service gave the run; `run-1` by default. */
  runId?: string
}

/** A hand-moved stand-in for the editor's debugger: it records its calls in the shared order and lets the test emit pauses. */
export class FakeNodeServerDebugger implements NodeServerDebugger {
  handlers?: NodeServerDebuggerHandlers
  nextToken = 0
  readonly resumed: number[] = []
  captureGate?: Promise<void>
  resumeGate?: Promise<void>
  releaseGate?: Promise<void>
  retireCount = 0
  releaseCount = 0
  lastSessionName = ''
  /** The adapter reported a stop whose stack the editor is still reading, so the run has not heard of it yet. */
  unreportedPause = false
  constructor(
    readonly input: NodeServerDebuggerInput,
    private readonly order: string[],
    private readonly options: HarnessOptions,
  ) {}

  assertSourcesUnchanged(): void {
    this.order.push('assertSourcesUnchanged')
    if (this.options.sourcesChanged) throw this.options.sourcesChanged
  }
  async attach(): Promise<void> {
    this.order.push('attach')
    if (this.options.attachFails) throw this.options.attachFails
  }
  subscribe(handlers: NodeServerDebuggerHandlers): { dispose(): void } {
    this.handlers = handlers
    return { dispose: () => undefined }
  }
  async armStops(
    stops: NodeServerStopTarget[],
  ): Promise<NodeServerArmedStop[]> {
    this.order.push('armStops')
    if (this.options.armFails) throw this.options.armFails
    return stops.map((stop) => ({
      declaredStopIndex: stop.declaredStopIndex,
      breakpointId: 100 + stop.declaredStopIndex,
      boundLine: stop.line,
    }))
  }
  async releaseEntry(): Promise<void> {
    this.order.push('releaseEntry')
    this.options.duringRelease?.(this)
  }
  setRequestWindow(open: boolean): void {
    this.order.push(`window:${open}`)
  }
  async capture(
    pause: NodeServerDebuggerPause,
  ): Promise<NodeServerStopCapture> {
    this.order.push(`capture:${pause.declaredStopIndex}`)
    await this.captureGate
    return {
      path: 'src/routes/users.ts',
      line: 14 + (pause.declaredStopIndex ?? 0),
      sourceHash: 'cited-hash',
      facts: [
        { path: 'user.id', mode: 'value', display: '7' },
        { path: 'user.id', mode: 'type', display: 'number' },
      ],
      unavailable: ['type:user.name'],
      snapshot: { version: 1, frames: [], variables: [], limitations: [] },
    }
  }
  async resume(pause: NodeServerDebuggerPause): Promise<void> {
    this.order.push(`resume:${pause.token}`)
    if (this.options.resumeEmitsOnResume || this.options.resumeFails)
      this.handlers?.onResume(pause.token)
    await this.resumeGate
    if (this.options.resumeFails) throw this.options.resumeFails
    this.resumed.push(pause.token)
  }
  async retireStops(): Promise<void> {
    this.order.push('retireStops')
    this.retireCount += 1
  }
  async release(): Promise<void> {
    this.order.push('debugger.release')
    this.releaseCount += 1
    await this.releaseGate
  }
  hasUnreportedPause(): boolean {
    return this.unreportedPause
  }

  /** The adapter reports a pause; returns its token. */
  pause(pause: Partial<NodeServerDebuggerPause> = {}): number {
    const token = ++this.nextToken
    this.handlers?.onPause({
      token,
      sessionId: 'session-1',
      threadId: 1,
      reason: 'breakpoint',
      ...pause,
    })
    return token
  }
  /** A hit of declared stop `index`. */
  hit(index = 0): number {
    return this.pause({
      declaredStopIndex: index,
      location: { path: 'src/routes/users.ts', line: 14 + index },
    })
  }
  /** A pause that is no declared stop: a learner breakpoint, `debugger;`, the pause button. */
  learnerPause(reason = 'breakpoint'): number {
    return this.pause({
      reason,
      location: { path: 'src/other.ts', line: 3 },
    })
  }
  /** The learner presses Continue in the editor. */
  nativeContinue(token: number): void {
    this.handlers?.onResume(token)
  }
}

/** The fixture server's stand-in: what `launchNodeServer` returns, driven by hand. */
export function fakeServer(
  order: string[],
  options: HarnessOptions,
  state: { exit?: NodeServerExit; output: string },
) {
  const exited = defer<NodeServerExit>()
  const closeGate = defer<void>()
  return {
    pid: 4242,
    processGroup: 4242,
    closeCalls: 0,
    closeWithDetach: [] as boolean[],
    /** The options each close was given, so a test reads the stop's clock and identity check the run passed. */
    closeOptions: [] as NodeServerCloseOptions[],
    closeGate,
    exitNow(exit: NodeServerExit): void {
      state.exit = exit
      exited.resolve(exit)
    },
    elapsedMs: () => 12,
    output: () => state.output,
    exited: (): NodeServerExit | undefined => state.exit,
    whenExited: () => exited.promise,
    async waitForExit(): Promise<NodeServerExit | undefined> {
      return state.exit
    },
    async inspectorEndpoint(signal?: AbortSignal): Promise<string> {
      if (options.inspectorEndpoint) return options.inspectorEndpoint(signal)
      return `ws://127.0.0.1:${options.inspectorPort ?? 9229}/abc`
    },
    async close(
      detach?: () => Promise<void>,
      closeOptions: NodeServerCloseOptions = {},
    ): Promise<NodeServerExit> {
      this.closeCalls += 1
      this.closeOptions.push(closeOptions)
      this.closeWithDetach.push(Boolean(detach))
      order.push('server.close')
      if (detach) {
        order.push('detach')
        await detach()
      }
      if (options.holdClose) await closeGate.promise
      order.push('server.closed')
      return state.exit ?? { exitCode: 0, signal: null }
    },
  }
}

/** The request sender's stand-in: the test settles `written` and `response`. */
export function fakeRequestSender(order: string[]) {
  const calls: Array<{
    stateAtCall?: string
    headers?: string
    signal?: AbortSignal
    sanitize?: (text: string) => string
  }> = []
  let current = {
    written: defer<void>(),
    response: defer<NodeServerResponse>(),
  }
  return {
    calls,
    /** The answers of the latest request; each send makes new ones, so a retry is testable. */
    get written() {
      return current.written
    },
    get response() {
      return current.response
    },
    bytesWritten: 0,
    connection: { localPort: 50_000, remotePort: 4100 },
    send(
      input: Parameters<NodeServerRunDependencies['sendRequest']>[0],
      stateAtCall: string,
    ) {
      order.push('sendRequest')
      calls.push({
        stateAtCall,
        headers: input.runId,
        signal: input.signal,
        sanitize: input.sanitize,
      })
      const answers = {
        written: defer<void>(),
        response: defer<NodeServerResponse>(),
      }
      current = answers
      // As the real sender: an abort ends both answers at once, and an aborted request writes nothing.
      const abort = (): void => {
        answers.written.reject(input.signal.reason)
        answers.response.reject(input.signal.reason)
      }
      if (input.signal.aborted) abort()
      else input.signal.addEventListener('abort', abort, { once: true })
      // The sender verifies the connected socket before it writes a byte; a failure leaves zero bytes sent.
      void input.verifyPeer(this.connection).then(
        () => {
          if (input.signal.aborted) return
          this.bytesWritten += 1
          answers.written.resolve()
        },
        (error: unknown) => {
          answers.written.reject(error)
          answers.response.reject(error)
        },
      )
      return {
        written: answers.written.promise,
        response: answers.response.promise,
      }
    },
  }
}

export const RESPONSE_200: NodeServerResponse = {
  status: 200,
  contentType: 'application/json',
  body: '{"id":7}',
  bodyBytes: 8,
  readCut: false,
  elapsedMs: 21,
}

/** The declaration every host test runs: a GET to one handler, with the second stop (when asked) in the same file. */
export function declaration(
  port: number,
  stops: 1 | 2,
): NodeServerConfiguration {
  const hash = 'a'.repeat(64)
  return {
    version: 1,
    adapter: 'node-server',
    book: {
      bookId: 'users-api',
      revision: 1,
      nodeId: 'handler',
      anchorIndex: 0,
    },
    packageRoot: '.',
    entry: 'server.js',
    loader: 'node',
    port,
    request: { method: 'GET', path: '/api/users/7' },
    source: { path: 'src/routes/users.ts', hash, line: 14, column: 3 },
    inspections: [{ path: 'user.id', mode: 'value', required: true }],
    additionalStops:
      stops === 2
        ? [
            {
              path: 'src/routes/users.ts',
              hash,
              line: 15,
              column: 3,
              anchorIndex: 1,
              inspections: [{ path: 'user.id', mode: 'value', required: true }],
            },
          ]
        : undefined,
  }
}

/** Builds a run against fakes and returns every handle a test needs. */
export function createHarness(options: HarnessOptions = {}) {
  const order: string[] = []
  const events: Array<{ type: string; detail: unknown }> = []
  const clock = createManualClock()
  const port = options.port ?? uniquePort()
  const serverState: { exit?: NodeServerExit; output: string } = {
    output: options.serverOutput ?? 'server log line\n',
  }
  const server = fakeServer(order, options, serverState)
  const sender = fakeRequestSender(order)
  const calls = {
    launch: 0,
    remembered: [] as Array<
      Parameters<NodeServerRunDependencies['rememberProcess']>[0]
    >,
    forgotten: [] as string[],
    signals: [] as Array<[number, string]>,
    /** What the process-start and working-folder readers answer for the launched leader; a test changes it to make the group id another process's. */
    leader: { start: 'start-1', cwd: WORKSPACE } as {
      start: string | undefined
      cwd: string | undefined
      /** Holds every start read until it settles, so a test can let a close return while an identity check still reads. */
      startGate?: Promise<void>
    },
    /** What the group probe answers from now on, in place of the `groupGone` option; a test sets it when the group ends mid-stop. */
    groupGone: undefined as boolean | undefined,
    /** A signal that fails once, as the system refuses one for a member the user may not signal (EPERM); a test sets it before the call. */
    failSignal: undefined as NodeJS.Signals | undefined,
    readiness: [] as Array<
      Parameters<NodeServerRunDependencies['waitForReadiness']>[0]
    >,
  }
  const debuggers: FakeNodeServerDebugger[] = []
  /** Hands the server's output to the run, as the launcher does. */
  let emitServerOutput: (
    text: string,
    channel?: 'stdout' | 'stderr',
  ) => Promise<void> = async () => undefined
  /** Settles when the run starts waiting for readiness. */
  const readinessStarted = defer<void>()
  const stopTargets = (stops: 1 | 2) =>
    (['', ''] as const).slice(0, stops).map((_, index) => ({
      declaredStopIndex: index,
      path: 'src/routes/users.ts',
      file: `${WORKSPACE}/src/routes/users.ts`,
      line: 14 + index,
      column: 3,
      hash: 'a'.repeat(64),
      inspections: [],
    }))
  const dependencies: NodeServerRunDependencies = {
    clock: {
      now: () => clock.now(),
      set: (callback, delayMs) => {
        const id = clock.setTimeout(callback, delayMs)
        return (): void => clock.clearTimeout(id)
      },
    },
    node: { executable: '/usr/bin/node', version: '26.0.0' },
    createDebugger: (input) => {
      const created = new FakeNodeServerDebugger(input, order, options)
      debuggers.push(created)
      return created
    },
    resolveLaunch: async () => {
      order.push('resolveLaunch')
      if (options.resolveLaunchFails) throw options.resolveLaunchFails
      return {
        packageRoot: WORKSPACE,
        entry: `${WORKSPACE}/server.js`,
        loader: { kind: 'node' },
      }
    },
    resolveStops: async () => {
      order.push('resolveStops')
      return stopTargets(options.stops ?? 1)
    },
    assertPortFree: async () => {
      order.push('assertPortFree')
      if (options.portTaken) throw options.portTaken
    },
    launch: async (_launch, _record, onOutput) => {
      order.push('launch')
      calls.launch += 1
      emitServerOutput = async (text, channel = 'stdout') =>
        void (await onOutput?.({
          sequence: 1,
          elapsedMs: 5,
          channel,
          text,
        }))
      await emitServerOutput('server log line\n')
      return server
    },
    signalGroup: (group, signal) => {
      order.push(`signal:${signal}`)
      calls.signals.push([group, signal])
      if (calls.failSignal === signal) {
        calls.failSignal = undefined
        throw Object.assign(new Error(`kill ${signal} EPERM`), {
          code: 'EPERM',
        })
      }
    },
    isGroupGone: () => calls.groupGone ?? options.groupGone ?? false,
    isProcessGone: () => options.processGone ?? false,
    readProcessStart: async () => {
      await calls.leader.startGate
      return options.leaderStartReads?.length
        ? options.leaderStartReads.shift()
        : calls.leader.start
    },
    readProcessCwd: async () => calls.leader.cwd,
    findPortOccupant: async () => {
      await options.occupantGate
      return options.occupant
    },
    waitForReadiness: async (input) => {
      order.push('waitForReadiness')
      calls.readiness.push(input)
      readinessStarted.resolve()
      if (options.waitForReadiness) return options.waitForReadiness(input)
      return { host: '127.0.0.1', bothAccept: false }
    },
    verifyListener: async () => {
      order.push('verifyListener')
      return options.listener ?? { owned: true }
    },
    readListeningPorts: async () => options.listeningPorts ?? [],
    readConnectionServerPid: async () => {
      await options.peerCheckGate
      return options.connectionHolders ?? [server.pid]
    },
    sendRequest: (input) => {
      if (options.sendThrows) throw options.sendThrows
      return sender.send(input, runtime.view().state)
    },
    rememberProcess: async (record) => {
      order.push('rememberProcess')
      calls.remembered.push(record)
    },
    forgetProcess: async (runId) => {
      order.push('forgetProcess')
      calls.forgotten.push(runId)
    },
  }
  /** One promise per event type, settled when the type was journaled. */
  const seen = new Map<string, ReturnType<typeof defer<void>>>()
  const citedSources: ConfiguredDescriptor['sources'] = []
  const runtime: NodeServerRuntime = createOwnedNodeServerRun({
    workspace: WORKSPACE,
    configuration: declaration(port, options.stops ?? 1),
    record: (type, detail) => {
      events.push({ type, detail })
      options.record?.(type, detail)
      seen.get(type)?.resolve()
      if (!seen.has(type)) {
        const settled = defer<void>()
        settled.resolve()
        seen.set(type, settled)
      }
    },
    citedSources,
    runId: options.runId ?? 'run-1',
    dependencies,
  })
  return {
    run: runtime,
    port,
    order,
    events,
    clock,
    server,
    sender,
    calls,
    emitOutput: (text: string, channel?: 'stdout' | 'stderr'): Promise<void> =>
      emitServerOutput(text, channel),
    /** Settles when the run journals an event of this type (it may already have). */
    eventSeen: (type: string): Promise<void> =>
      seen.get(type)?.promise ??
      (seen.set(type, defer<void>()), seen.get(type)!.promise),
    readinessStarted: readinessStarted.promise,
    debuggers,
    get debug(): FakeNodeServerDebugger {
      const [first] = debuggers
      if (!first) throw new Error('The run created no debugger yet.')
      return first
    },
  }
}

export type Harness = ReturnType<typeof createHarness>

/** Prepares the run and returns the harness, ready for its request. */
export async function readyHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const harness = createHarness(options)
  await harness.run.prepare()
  return harness
}

/** Sends the request and answers its connection, so the run reads `request-in-flight`. */
export async function sendRequest(
  harness: Harness,
  key = 'key-1',
): Promise<void> {
  await harness.run.sendRequest(key)
}

/**
 * Waits until the run's view satisfies a condition, by listening to its changes; no timer is involved.
 * @param harness - The harness under test.
 * @param condition - Reads the view.
 * @returns The view that satisfied it.
 * @example await until(harness, (view) => view.state === 'paused')
 */
export function until(
  harness: Harness,
  condition: (view: ReturnType<NodeServerRuntime['view']>) => boolean,
): Promise<ReturnType<NodeServerRuntime['view']>> {
  const current = harness.run.view()
  if (condition(current)) return Promise.resolve(current)
  return new Promise((resolve) => {
    const subscription = harness.run.onDidChange(() => {
      const view = harness.run.view()
      if (!condition(view)) return
      subscription.dispose()
      resolve(view)
    })
  })
}
