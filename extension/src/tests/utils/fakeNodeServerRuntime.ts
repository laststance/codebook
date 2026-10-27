import { StudyError } from '../../errors'
import type {
  NodeServerCapture,
  NodeServerHeldPause,
  NodeServerRequestFailure,
  NodeServerResponse,
  NodeServerRuntime,
  NodeServerState,
  NodeServerView,
} from '../../runtime'
import type { PauseIdentity } from '../../runtimeSupport/pauseGate'

import { defer } from './defer'

/** The address, session and thread every fake pause uses, so a test writes the arguments it expects. */
export const FAKE_SERVER_ADDRESS = '127.0.0.1:4100'
export const FAKE_SERVER_SESSION_ID = 'server-session'
export const FAKE_SERVER_THREAD_ID = 7

/**
 * A stand-in for the node-server run (Issue #139 part R) that a test drives by hand: it reaches every {@link NodeServerState}, pauses at declared stops with generations, holds learner and unattributed pauses, answers or fails the request, fails the run, fails stops, and fires {@link NodeServerRuntime.onDidChange} after every change, so the service, MCP, resources and status item are tested without a process, a debugger or a socket.
 * It enforces the run-side refusals of the contract (`RUN_NOT_READY`, `REQUEST_ALREADY_SENT`, `LEARNER_PAUSED`, `NO_PAUSE`, `STALE_PAUSE`) the way the real run does, and logs each call in {@link FakeNodeServerRuntime.calls}.
 * @example
 * const run = new FakeNodeServerRuntime()
 * await run.prepare()
 * await run.sendRequest('k1')
 * run.pauseAt(0, { nextTheme: 'dark' }) // run.view().state === 'paused'
 */
export class FakeNodeServerRuntime implements NodeServerRuntime {
  readonly id = 'fake-server-run'
  /** Each call the service made, in order, as `prepare`, `sendRequest:<key>`, `continue:<generation>` and `stop`. */
  readonly calls: string[] = []
  /** How many of the next `stop()` calls fail with `RUNTIME_FAILED`. */
  stopFailures = 0
  /** When set, `prepare()` rejects with it instead of reaching `ready`. */
  prepareFailure?: StudyError
  /** When set, `prepare()` waits for it before it settles (a preparation a stop can cancel). */
  readonly prepareGate = defer<void>()
  holdsPrepare = false
  /** Receives the events the service passes to the environment's `record` callback. */
  record: (type: string, detail?: unknown) => unknown = () => undefined
  private current: NodeServerView = {
    state: 'preparing',
    stops: [
      { declaredStopIndex: 0, path: 'src/theme.ts', declaredLine: 1 },
      { declaredStopIndex: 1, path: 'src/theme.ts', declaredLine: 1 },
    ],
    stopsHitAtStart: [],
    stopsReached: [],
    pauseGeneration: 0,
    captures: [],
    captureBudgetExhausted: false,
    failedStops: 0,
  }
  private readonly listeners = new Set<() => void>()

  async prepare(): Promise<void> {
    this.calls.push('prepare')
    if (this.holdsPrepare) await this.prepareGate.promise
    // A stop settles a preparation in flight, as the real run's does.
    if (this.current.state === 'stopped')
      throw new StudyError('RUNTIME_FAILED', 'Stopped during preparation.')
    if (this.prepareFailure) throw this.prepareFailure
    this.change({ state: 'ready', address: { host: '127.0.0.1', port: 4100 } })
  }

  view(): NodeServerView {
    return { ...this.current }
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  async sendRequest(key: string): Promise<void> {
    this.calls.push(`sendRequest:${key}`)
    if (this.current.heldPause) throw new StudyError('LEARNER_PAUSED', 'held')
    if (this.current.request)
      throw new StudyError('REQUEST_ALREADY_SENT', 'sent')
    if (this.current.state !== 'ready')
      throw new StudyError('RUN_NOT_READY', 'not ready')
    this.change({
      state: 'request-in-flight',
      request: {
        key,
        method: 'GET',
        path: '/api/healthz',
        bodyBytes: 0,
        address: FAKE_SERVER_ADDRESS,
        sentAtMs: 5,
      },
    })
  }

  async continue(pause: PauseIdentity): Promise<void> {
    this.calls.push(`continue:${pause.generation}`)
    if (this.current.heldPause) throw new StudyError('LEARNER_PAUSED', 'held')
    const reserved = this.current.pause
    if (!reserved) throw new StudyError('NO_PAUSE', 'no pause')
    if (
      reserved.generation !== pause.generation ||
      reserved.sessionId !== pause.sessionId ||
      reserved.threadId !== pause.threadId
    )
      throw new StudyError('STALE_PAUSE', 'stale')
    this.change({ state: 'request-in-flight', pause: undefined })
  }

  async stop(): Promise<void> {
    this.calls.push('stop')
    if (this.stopFailures > 0) {
      this.stopFailures--
      this.change({
        state: 'stopping',
        failedStops: this.current.failedStops + 1,
      })
      // The second failed stop names the pid for the learner to end (D9); the run words it, the service passes it on.
      throw new StudyError(
        'RUNTIME_FAILED',
        this.current.failedStops > 1
          ? 'The server did not end; end process 4242 yourself.'
          : 'The server did not end.',
      )
    }
    this.change({ state: 'stopped', pause: undefined, heldPause: undefined })
    // A stop settles a preparation that is still held, as the real run's does.
    this.prepareGate.resolve()
  }

  /** Merges a change into the view and tells the listeners. @example run.change({ state: 'ready' }) */
  change(patch: Partial<NodeServerView>): void {
    this.current = { ...this.current, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  /** The request has paused at declared stop `index` with the given captured facts and a new pause generation. @example run.pauseAt(0, { nextTheme: 'dark' }) */
  pauseAt(index: number, facts: Record<string, unknown> = {}): void {
    const generation = this.current.pauseGeneration + 1
    const capture: NodeServerCapture = {
      declaredStopIndex: index,
      stopNumber: index + 1,
      pauseGeneration: generation,
      path: 'src/theme.ts',
      line: 1,
      sourceHash: 'a'.repeat(64),
      facts,
      unavailable: [],
      capturedAtMs: 20 + generation,
      attribution: 'timing',
    }
    this.change({
      state: 'paused',
      pauseGeneration: generation,
      captures: [...this.current.captures, capture],
      stopsReached: [...this.current.stopsReached, index],
      pause: {
        sessionId: FAKE_SERVER_SESSION_ID,
        threadId: FAKE_SERVER_THREAD_ID,
        generation,
        declaredStopIndex: index,
        stopNumber: index + 1,
        captureIndex: this.current.captures.length,
      },
    })
  }

  /** The request ended with a response. @example run.respond({ status: 200, body: '{"status":"ok"}' }) */
  respond(response: Partial<NodeServerResponse> = {}): void {
    this.change({
      state: 'responded',
      pause: undefined,
      response: {
        status: 200,
        contentType: 'application/json',
        body: '{"status":"ok"}',
        bodyBytes: 15,
        readCut: false,
        elapsedMs: 12,
        ...response,
      },
    })
  }

  /** The request failed; the run, the server and the debugger go on. @example run.failRequest('REQUEST_FAILED', 'Connection reset.') */
  failRequest(code: NodeServerRequestFailure['code'], message: string): void {
    this.change({
      state: 'request-failed',
      pause: undefined,
      requestFailure: { code, message },
    })
  }

  /** The learner paused the server in the native debugger. @example run.learnerPause() */
  learnerPause(kind: NodeServerHeldPause['kind'] = 'learner'): void {
    this.change({
      state: kind === 'learner' ? 'learner-paused' : 'unattributed',
      pause: undefined,
      heldPause: {
        kind,
        reason: 'breakpoint',
        sessionId: FAKE_SERVER_SESSION_ID,
        threadId: FAKE_SERVER_THREAD_ID,
        path: 'src/theme.ts',
        line: 1,
      },
    })
  }

  /** The run failed on its own (the server exited, the pause hold expired). @example run.failRun(new StudyError('SERVER_EXITED', 'exit 1')) */
  failRun(error: StudyError): void {
    this.change({ runFailure: error })
  }

  /**
   * Puts the run into one of the ten states the way the real run would reach it, so a table of states can drive every call.
   * `ready` and `preparing` have sent nothing; every state after the request has sent `fake-request`.
   * @param state - The state to enter.
   * @example await run.enter('paused') // run.view().pause?.generation === 1
   */
  async enter(state: NodeServerState): Promise<void> {
    if (state === 'preparing') return
    await this.prepare()
    if (state === 'ready') return
    await this.sendRequest('fake-request')
    if (state === 'request-in-flight') return
    if (state === 'paused') this.pauseAt(0, { nextTheme: 'dark' })
    if (state === 'learner-paused') this.learnerPause('learner')
    if (state === 'unattributed') this.learnerPause('unattributed')
    if (state === 'responded') this.respond()
    if (state === 'request-failed')
      this.failRequest('REQUEST_FAILED', 'Connection reset.')
    if (state === 'stopping') {
      this.stopFailures = 1
      await this.stop().catch(() => undefined)
    }
    if (state === 'stopped') await this.stop()
  }
}
