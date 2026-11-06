import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  MS_PER_MINUTE,
  NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE,
  NODE_SERVER_READY_TIMEOUT_MS,
  NODE_SERVER_REQUEST_TIMEOUT_MS,
  NODE_SERVER_REQUEST_WALL_LIMIT_MS,
} from './constants'
import { StudyError } from './errors'
import {
  NodeProcessRun,
  type NodeProcessRunDependencies,
  type NodeProcessSnapshot,
  type OwnedNodeProcess,
} from './nodeProcessRun'
import type { NodeServerConfiguration } from './nodeServerConfigSchemas'
import type { NodeServerHistorySink } from './nodeServerHistorySink'
import type {
  NodeServerResponse,
  NodeServerRuntime,
  NodeServerSentRequest,
  NodeServerSignInView,
  NodeServerState,
  NodeServerView,
} from './runtime'
import type { PauseIdentity } from './runtimeSupport/pauseGate'
import {
  applySetCookies,
  cookieHeaderOf,
  type SessionCookies,
} from './utils/applySetCookies'
import { buildSignInBody } from './utils/buildSignInBody'
import type {
  KnownValueMask,
  ProcessOutputEvent,
} from './utils/captureProcessOutput'
import { cookieMaskValues } from './utils/cookieMaskValues'
import {
  sanitizeRunCause,
  serverExitedError,
  serverNotListeningError,
  stepFailedError,
} from './utils/describeNodeServerRunFailure'
import { expandLearnerSecretForms } from './utils/expandLearnerSecretForms'
import type { PortOccupant } from './utils/findPortOccupant'
import { maskLearnerSecretData } from './utils/maskLearnerSecretData'
import { maskRunSecrets } from './utils/maskRunSecrets'
import { createNodeRunHistoryHooks } from './utils/nodeRunHistoryHooks'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
  type OwnedDevelopmentPortClaim,
} from './utils/ownedDevelopmentPorts'
import type { resolveNodeServerLaunch } from './utils/resolveNodeServerLaunch'
import type { resolveNodeServerStops } from './utils/resolveNodeServerStops'
import { RunChangeListeners } from './utils/RunChangeListeners'
import { RunningTimeLimit, type RunClock } from './utils/runningTimeLimit'
import { hidePrivateRoots } from './utils/sanitizeCause'
import type { CauseRoots } from './utils/sanitizeCause'
import { signInOutcomeOf } from './utils/signInOutcomeOf'

/** The expanded masking forms of a run's secrets and the length of the longest. */
type MaskCache = { forms: ReadonlySet<string>; longestChars: number }

/** The server and the loopback endpoint a request that passed the run's state checks goes to. */
type ReadyForRequest = {
  host: '127.0.0.1' | '::1'
  port: number
  server: OwnedNodeProcess
}

/** The codes a request failure of the run can carry. */
type RequestFailureCode = NonNullable<NodeServerView['requestFailure']>['code']

/**
 * Tells whether a send failure is a refusal before any byte left (a listener that is not the server, an unreadable owner, or a stop admitted first).
 * Called by the request paths to keep a run ready after such a refusal.
 * @param error - Anything a sender rejected with.
 * @returns True for those {@link StudyError}s.
 * @example isRefusalBeforeAnyByte(new StudyError('LISTENER_NOT_OWNED', 'x')) // => true
 */
function isRefusalBeforeAnyByte(error: unknown): error is StudyError & {
  code: 'LISTENER_NOT_OWNED' | 'PORT_OWNER_UNKNOWN' | 'RUN_NOT_READY'
} {
  return (
    error instanceof StudyError &&
    (error.code === 'LISTENER_NOT_OWNED' ||
      error.code === 'PORT_OWNER_UNKNOWN' ||
      error.code === 'RUN_NOT_READY')
  )
}

/**
 * Copies a refusal with the phase of the request it refused, so an agent tells the sign-in from the declared request.
 * @param error - The refusal.
 * @param phase - `sign-in` for the sign-in request.
 * @returns A {@link StudyError} of the same code and message with `details.phase`.
 * @example withPhase(new StudyError('LISTENER_NOT_OWNED', 'x'), 'sign-in').details // => { phase: 'sign-in' }
 */
function withPhase(error: StudyError, phase: 'sign-in'): StudyError {
  return new StudyError(
    error.code,
    error.message,
    error.causeDetail,
    error.recoveryOverride,
    error.cause,
    { ...error.details, phase },
  )
}

/** The loopback endpoint readiness selected. */
type ServerAddress = { host: '127.0.0.1' | '::1'; port: number }

/** What a run needs from outside, injected so the whole state machine runs against fakes: the process core's dependencies ({@link NodeProcessRunDependencies}) and the utilities of the request and listener parts. */
export type NodeServerRunDependencies = NodeProcessRunDependencies & {
  resolveLaunch: typeof resolveNodeServerLaunch
  resolveStops: typeof resolveNodeServerStops
  /** Refuses with `PORT_UNAVAILABLE` while the declared port is taken. */
  assertPortFree(input: { port: number; signal: AbortSignal }): Promise<void>
  findPortOccupant(port: number): Promise<PortOccupant | undefined>
  waitForReadiness(input: {
    port: number
    hasTimeLeft: () => boolean
    signal: AbortSignal
  }): Promise<{ host: '127.0.0.1' | '::1'; bothAccept: boolean } | undefined>
  verifyListener(input: {
    port: number
    selectedHost: '127.0.0.1' | '::1'
    ownerPid: number
    processGroup: number
    acceptedWithoutListener?: boolean
  }): Promise<
    | { owned: true }
    | {
        owned: false
        code: 'LISTENER_NOT_OWNED' | 'PORT_OWNER_UNKNOWN'
        message: string
      }
  >
  readConnectionServerPid(input: {
    clientPort: number
    serverPort: number
  }): Promise<number[]>
  sendRequest(input: {
    host: '127.0.0.1' | '::1'
    port: number
    request: NodeServerConfiguration['request']
    runId: string
    verifyPeer: (connection: {
      localPort: number
      remotePort: number
    }) => Promise<void>
    signal: AbortSignal
    /** Hides private roots in the response body before it is cut for display. */
    sanitize?: (text: string) => string
    /** Sent as the `Cookie` header of the declared request when the sign-in gave a session. */
    cookie?: string
    /** Called when the response headers arrive, with the raw `Set-Cookie` values; the sign-in request only. */
    onSetCookie?: (values: readonly string[]) => void
  }): { written: Promise<void>; response: Promise<NodeServerResponse> }
}

/** What {@link createOwnedNodeServerRun} is given. */
export type NodeServerRunInput = {
  /** The opened repository's real root. */
  workspace: string
  configuration: NodeServerConfiguration
  /** Journals the run's `node-server.*` events. */
  record: (type: string, detail?: unknown) => unknown
  /** The article's text of every source the selected node cites (the debugger refuses a start while the editor holds other text). */
  citedSources: ConfiguredDescriptor['sources']
  /** The service's run id: sent as `x-codebook-run`, named in the debug session and the orphan record. */
  runId: string
  /** Where the run reports what a saved server replay records; absent when no history started. It is told synchronously and never awaited, and nothing it does reaches the run. */
  history?: NodeServerHistorySink
  /** The private roots the service hides everywhere (storage, learning directory, workspace, home), frozen for this run: used for the server's output and the response body, so both read the same placeholders as the history, which hides with the same snapshot; absent in tests, where the workspace and the home directory are used. */
  privateRoots?: CauseRoots
  dependencies: NodeServerRunDependencies
}

/**
 * The node-server run the service drives (Issue #139 tasks 9–10): it launches the repository's server under the debugger, arms the declared stops, sends the declared request once, captures its hits and stops the server.
 * Its state is derived from what happened (lifecycle, held pauses, current pause, request outcome), so a state "returns to what it was" when a held pause is continued.
 * The process, its pauses and its stop belong to the composition core ({@link NodeProcessRun}); this class keeps the declared port, readiness, listener verification and the request.
 */
class OwnedNodeServerRun implements NodeServerRuntime {
  readonly id: string
  private readonly listeners = new RunChangeListeners()
  private readonly clock: RunClock
  private readonly readiness: RunningTimeLimit
  private readonly requestLimit: RunningTimeLimit
  private readonly core: NodeProcessRun
  private portClaim?: OwnedDevelopmentPortClaim
  private address?: ServerAddress
  // The declared request.
  private request?: NodeServerSentRequest
  private requestAbort = new AbortController()
  private requestToken = 0
  private requestEnded = false
  private cancelWall?: () => void
  private response?: NodeServerResponse
  private requestFailure?: NodeServerView['requestFailure']
  // The optional sign-in (a run without `signIn` never touches any of these).
  /** The learner's typed secret and the session cookie forms, in memory only; every sink the run owns masks them. */
  private readonly secrets = new Set<string>()
  /** The expanded masking forms of {@link OwnedNodeServerRun.secrets}, rebuilt only when the set changes. */
  private maskCache?: MaskCache
  private signInView: NodeServerSignInView = { state: 'none' }
  /** True from the moment the sign-in window opens until its response headers (or its end) settle what the output may show. */
  private awaitingSignInHeaders = false
  /** Which of the two requests is under way: the sign-in, then the declared request. */
  private requestPhase: 'sign-in' | 'request' = 'request'
  private cookies?: SessionCookies
  private signInStartedMs = 0

  constructor(private readonly input: NodeServerRunInput) {
    this.id = input.runId
    this.clock = input.dependencies.clock
    this.readiness = new RunningTimeLimit(
      NODE_SERVER_READY_TIMEOUT_MS,
      this.clock,
      () => undefined,
    )
    this.requestLimit = new RunningTimeLimit(
      NODE_SERVER_REQUEST_TIMEOUT_MS,
      this.clock,
      () => this.timeOutRequest('running-time'),
    )
    this.core = new NodeProcessRun({
      workspace: input.workspace,
      runId: input.runId,
      record: (type, detail) => this.record(type, detail),
      citedSources: input.citedSources,
      declaredPort: input.configuration.port,
      privateRoots: input.privateRoots,
      dependencies: input.dependencies,
      notify: () => this.notify(),
      // Only a run with sign-in holds secret values to mask in its output and stop captures.
      ...(input.configuration.signIn
        ? {
            knownValues: this.knownValues(),
            maskKnownText: (text: string) => this.maskText(text),
          }
        : {}),
      hooks: {
        inWindow: () => this.inRequestWindow(),
        inSignIn: () => this.signInView.state === 'signing-in',
        holdLimits: () => {
          this.readiness.hold()
          this.requestLimit.hold()
        },
        releaseLimits: () => {
          this.readiness.release()
          this.requestLimit.release()
        },
        onStopAdmitted: () => this.cancelRequestAndTimers(),
        onProcessOutput: (event) => this.onServerOutput(event),
        ...createNodeRunHistoryHooks(input.history),
        onReleaseBegin: () => {
          if (this.portClaim) beginReleaseOfOwnedDevelopmentPort(this.portClaim)
        },
        onReleased: () => {
          if (this.portClaim) releaseOwnedDevelopmentPort(this.portClaim)
        },
        onStopped: () => this.reportForeignListener(),
      },
    })
  }

  private get dependencies(): NodeServerRunDependencies {
    return this.input.dependencies
  }

  /** Journals one event of the run, with the run's known secret values masked in every string of its detail. */
  private record(type: string, detail?: unknown): void {
    this.input.record(
      type,
      this.secrets.size === 0
        ? detail
        : maskLearnerSecretData(detail, this.secrets),
    )
  }

  get learnerSecrets(): ReadonlySet<string> | undefined {
    return this.input.configuration.signIn ? this.secrets : undefined
  }

  /**
   * Adds values to the run's secrets; the masking forms are rebuilt only when the set grew.
   * @param values - The typed secret or the cookie mask values; empty strings are ignored.
   */
  private addSecrets(values: readonly string[]): void {
    const before = this.secrets.size
    for (const value of values) if (value !== '') this.secrets.add(value)
    if (this.secrets.size !== before) this.maskCache = undefined
  }

  /** The cached masking forms of the run's secrets (raw, percent-, form-, HTML- and JSON-escaped). */
  private maskForms(): MaskCache {
    if (!this.maskCache) {
      const forms = expandLearnerSecretForms(this.secrets, true)
      this.maskCache = {
        forms,
        longestChars: Math.max(0, ...[...forms].map((form) => form.length)),
      }
    }
    return this.maskCache
  }

  /**
   * Masks the run's known secret values in a text, in every form a server may echo them.
   * @param text - Any text the run publishes or stores.
   * @returns The text itself when the run holds no secret.
   */
  private maskText(text: string): string {
    if (this.secrets.size === 0) return text
    return maskRunSecrets(text, this.maskForms().forms)
  }

  /** The mask the launcher applies to the server's output; every member is read at call time because the set grows during the sign-in. */
  private knownValues(): KnownValueMask {
    return {
      mask: (text) => this.maskText(text),
      holdback: () =>
        this.awaitingSignInHeaders
          ? Number.POSITIVE_INFINITY
          : this.secrets.size === 0
            ? 0
            : this.maskForms().longestChars,
      onWithheld: (bytes): void =>
        this.record('node-server.output-withheld', { bytes }),
    }
  }

  /**
   * Ends the hold on the server's output once the sign-in exchange settled what it may show.
   * @param output - `release` publishes the held output under the mask (the exchange gave its cookies, or no byte was sent); `drop` discards it (the exchange ended without headers, so a session value may be in it).
   */
  private endOutputHold(output: 'release' | 'drop'): void {
    if (!this.awaitingSignInHeaders) return
    this.awaitingSignInHeaders = false
    const server = this.core.launched
    if (output === 'release') server?.releaseHeldOutput?.()
    else server?.dropHeldOutput?.()
  }

  setSignInAwaiting(awaiting: boolean): void {
    if (!this.input.configuration.signIn) return
    const { state } = this.signInView
    if (awaiting && state === 'none')
      this.signInView = { state: 'awaiting-learner' }
    else if (!awaiting && state === 'awaiting-learner')
      this.signInView = { state: 'none' }
    else return
    this.notify()
  }

  onDidChange(listener: () => void): { dispose(): void } {
    return this.listeners.add(listener)
  }

  private notify(): void {
    this.listeners.notify()
  }

  /**
   * Derives the state from what happened, in the order a reader needs: the end of the run first, then a held pause, a declared-stop pause, the request's outcome, the request in flight, readiness.
   * @param snapshot - The core's state.
   * @returns The state of the run's table.
   * @example this.currentState(this.core.snapshot()) // => 'request-in-flight' after the request was sent and nothing answered
   */
  private currentState(snapshot: NodeProcessSnapshot): NodeServerState {
    if (snapshot.lifecycle !== 'live') return snapshot.lifecycle
    if (snapshot.heldPause)
      return snapshot.heldPause.kind === 'learner'
        ? 'learner-paused'
        : 'unattributed'
    if (snapshot.pause) return 'paused'
    if (this.requestFailure) return 'request-failed'
    if (this.response) return 'responded'
    if (this.request) return 'request-in-flight'
    return snapshot.prepared ? 'ready' : 'preparing'
  }

  view(): NodeServerView {
    const snapshot = this.core.snapshot()
    return {
      state: this.currentState(snapshot),
      pid: snapshot.pid,
      address: this.address && { ...this.address },
      stops: snapshot.stops,
      stopsHitAtStart: snapshot.stopsHitAtStart,
      ...(this.input.configuration.signIn
        ? {
            stopsHitDuringSignIn: snapshot.stopsHitDuringSignIn,
            signIn: { ...this.signInView },
          }
        : {}),
      stopsReached: snapshot.stopsReached,
      pauseGeneration: snapshot.pauseGeneration,
      pause: snapshot.pause,
      heldPause: snapshot.heldPause,
      request: this.request && { ...this.request },
      response: this.response,
      requestFailure: this.requestFailure && { ...this.requestFailure },
      captures: snapshot.captures,
      captureBudgetExhausted: snapshot.captureBudgetExhausted,
      runFailure: snapshot.runFailure,
      failedStops: snapshot.failedStops,
    }
  }

  // ---------------------------------------------------------------- preparation

  prepare(): Promise<void> {
    const { workspace, configuration } = this.input
    return this.core.prepare({
      resolveStops: () =>
        this.dependencies.resolveStops(workspace, configuration),
      resolveLaunch: () =>
        this.dependencies.resolveLaunch(workspace, configuration),
      beforeLaunch: (signal) =>
        this.dependencies.assertPortFree({ port: configuration.port, signal }),
      // The server's port is claimed from the launch on.
      afterLaunch: () => {
        this.portClaim = claimOwnedDevelopmentPort(configuration.port)
      },
      beforeRelease: () => this.readiness.start(),
      afterRelease: () => this.becomeReady(),
    })
  }

  /** A stop was admitted: the request still checking its connection writes nothing, and every running-time limit and the wall limit stop. */
  private cancelRequestAndTimers(): void {
    // A request still checking its connection writes nothing once the stop is admitted.
    this.requestAbort.abort(
      new StudyError(
        'RUN_NOT_READY',
        'The run was stopped before its request was written, so nothing was sent.',
      ),
    )
    this.readiness.stop()
    this.requestLimit.stop()
    this.cancelWall?.()
  }

  /**
   * Journals one chunk of the server's output. Node's own notice on stderr that only the attached debugger keeps a finished program alive lets the run's debugger go, so the exit follows and is reported as one.
   * The notice must be a line of stderr by itself, outside the request, and the process must listen on nothing but its inspector: output an application logs (stdout, a request's body, a database value) never counts.
   * @param event - The stamped chunk.
   */
  private async onServerOutput(event: ProcessOutputEvent): Promise<void> {
    if (
      event.channel === 'stderr' &&
      this.core.lifecycle === 'live' &&
      !this.inRequestWindow() &&
      event.text
        .split('\n')
        .some(
          (line) =>
            line.trim().replace(/\.+$/, '') ===
            NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE,
        )
    )
      await this.core.releaseFinishedServer()
    // The launcher's mask already hid the run's secrets; masking again here keeps a launcher without one from leaking into the history.
    const text = this.maskText(event.text)
    this.input.history?.output(event.elapsedMs, event.channel, text)
    this.record('node-server.output', {
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      channel: event.channel,
      text,
    })
  }

  /** Waits for the server to accept on its declared port, verifies the listener and publishes `ready`. */
  private async becomeReady(): Promise<void> {
    const server = this.requireServer()
    const { port } = this.input.configuration
    const accepted = await this.awaitAcceptance(server, port)
    const { pid, processGroup } = this.core.identityOf(server)
    const verdict = await this.dependencies.verifyListener({
      port,
      selectedHost: accepted.host,
      ownerPid: pid,
      processGroup,
      acceptedWithoutListener: true,
    })
    if (!verdict.owned) throw new StudyError(verdict.code, verdict.message)
    this.readiness.stop()
    this.address = { host: accepted.host, port }
    this.core.markPrepared()
    this.record('node-server.ready', { host: accepted.host, port })
    this.notify()
  }

  /** The launched server, which exists from the launch on. */
  private requireServer(): OwnedNodeProcess {
    const server = this.core.launched
    if (!server) throw new Error('The run has no server yet.')
    return server
  }

  /**
   * Polls the declared port until it accepts, within the readiness budget of running time, or until the server exits first.
   * @returns The accepted loopback address.
   * @throws `SERVER_EXITED` when the server exited first; `SERVER_NOT_LISTENING` when the budget passed (naming the port the launched process listens on instead, if any); the run's failure when a pause hold expired.
   */
  private async awaitAcceptance(
    server: OwnedNodeProcess,
    port: number,
  ): Promise<{ host: '127.0.0.1' | '::1'; bothAccept: boolean }> {
    const exited = server.whenExited()
    const outcome = await Promise.race([
      this.dependencies.waitForReadiness({
        port,
        hasTimeLeft: () => this.readiness.hasTimeLeft(),
        signal: this.core.signal,
      }),
      exited.then((exit) => ({ exit })),
    ])
    if (outcome && 'exit' in outcome)
      throw serverExitedError(
        outcome.exit,
        server.output(),
        this.input.workspace,
      )
    if (outcome) return outcome
    if (this.core.runFailure) throw this.core.runFailure
    throw serverNotListeningError(port, await this.listeningElsewhere(server))
  }

  /** Finds the port the launched process listens on other than the declared one and the inspector's. */
  private async listeningElsewhere(
    server: OwnedNodeProcess,
  ): Promise<number | undefined> {
    if (server.pid === undefined) return undefined
    const ports = await this.dependencies
      .readListeningPorts(server.pid)
      .catch(() => [])
    return ports.find(
      (port) =>
        port !== this.input.configuration.port &&
        port !== this.core.inspectorPort,
    )
  }

  /** Whether the declared request is under way: sent, and not answered or failed yet. */
  private inRequestWindow(): boolean {
    return this.request !== undefined && !this.requestEnded
  }

  continue(identity: PauseIdentity): Promise<void> {
    return this.core.continue(identity)
  }

  // ---------------------------------------------------------------- the declared request

  async sendRequest(key: string, options?: { secret?: string }): Promise<void> {
    const ready = this.assertReadyForRequest()
    const { signIn } = this.input.configuration
    if (signIn) return this.sendSignInRequest(key, ready, options?.secret)
    const { host, port } = ready
    const declared = this.input.configuration.request
    const token = ++this.requestToken
    this.openRequestWindow(key, host, port, declared)
    const handle = this.startSender(token, this.senderInput(ready, declared))
    handle.response.then(
      (response) => this.onResponse(response, token),
      (error: unknown) => void this.onRequestError(error, token),
    )
    await this.awaitWritten(token, handle, () => this.recordSentRequest(token))
  }

  /**
   * Builds what every sender of the run is given: the endpoint, the request, the run id, the owned-peer check, the abort signal and the body sanitizer.
   * @param ready - The server and endpoint.
   * @param request - The request to send.
   * @param extra - A body sanitizer other than the private-root one, the `Cookie` header value, or the `Set-Cookie` observer.
   * @returns The sender's input; the optional members are present only when given.
   */
  private senderInput(
    ready: ReadyForRequest,
    request: NodeServerConfiguration['request'],
    extra: Pick<
      Parameters<NodeServerRunDependencies['sendRequest']>[0],
      'sanitize' | 'cookie' | 'onSetCookie'
    > = {},
  ): Parameters<NodeServerRunDependencies['sendRequest']>[0] {
    const { host, port, server } = ready
    const { sanitize, ...rest } = extra
    return {
      host,
      port,
      request,
      runId: this.input.runId,
      verifyPeer: (connection): Promise<void> =>
        this.verifyPeer(connection, server, port),
      signal: this.requestAbort.signal,
      // The body is the server's own text: only private roots are hidden, its spacing and lines stay.
      sanitize:
        sanitize ??
        ((text) => hidePrivateRoots(text, this.core.privateRoots())),
      ...rest,
    }
  }

  /**
   * Starts a sender; one that cannot start takes the request window back, so the request may be tried again.
   * @param token - The request's token.
   * @param input - What the sender is given.
   * @param phase - `sign-in` names the phase in a refusal.
   * @returns The sender's two promises.
   * @throws The sender's refusal, or `REQUEST_FAILED` when it threw something else.
   */
  private startSender(
    token: number,
    input: Parameters<NodeServerRunDependencies['sendRequest']>[0],
    phase?: 'sign-in',
  ): ReturnType<NodeServerRunDependencies['sendRequest']> {
    try {
      return this.dependencies.sendRequest(input)
    } catch (error) {
      this.closeRequestWindow(
        token,
        error instanceof StudyError ? error.code : undefined,
      )
      if (error instanceof StudyError)
        throw phase ? withPhase(error, phase) : error
      throw new StudyError(
        'REQUEST_FAILED',
        `The ${phase ? 'sign-in ' : ''}request could not be started: ${sanitizeRunCause(error, this.input.workspace)}`,
        undefined,
        undefined,
        undefined,
        phase ? { phase } : undefined,
      )
    }
  }

  /**
   * Waits until the request's bytes are written.
   * @param token - The request's token.
   * @param handle - The sender's promises.
   * @param onWritten - Called once the bytes are written.
   * @param phase - `sign-in` names the phase in a refusal.
   * @throws A refusal before any byte (a listener that is not the server, or a stop admitted first): the window is taken back and nothing was sent. Any other failure is reported by the response promise, which rejects with it too.
   */
  private async awaitWritten(
    token: number,
    handle: ReturnType<NodeServerRunDependencies['sendRequest']>,
    onWritten?: () => void,
    phase?: 'sign-in',
  ): Promise<void> {
    try {
      await handle.written
      onWritten?.()
    } catch (error) {
      if (isRefusalBeforeAnyByte(error)) {
        this.closeRequestWindow(token, error.code)
        throw phase ? withPhase(error, phase) : error
      }
    }
  }

  /**
   * Refuses a request the run's state does not admit.
   * @returns The server and the loopback endpoint the request goes to.
   * @throws A held pause's refusal, `REQUEST_ALREADY_SENT` and `RUN_NOT_READY`.
   */
  private assertReadyForRequest(): ReadyForRequest {
    this.core.assertNoHeldPause()
    if (this.request)
      throw new StudyError(
        'REQUEST_ALREADY_SENT',
        'This run already sent its request; read the run for its outcome.',
      )
    const server = this.core.launched
    if (
      this.currentState(this.core.snapshot()) !== 'ready' ||
      !this.address ||
      !server
    )
      throw new StudyError(
        'RUN_NOT_READY',
        'The server is not ready for its request yet.',
      )
    return { host: this.address.host, port: this.address.port, server }
  }

  /**
   * Sends the sign-in request that precedes the declared request; resolves once its bytes are written (the receipt of D10). The declared request follows by itself after a sign-in response that keeps a session cookie.
   * The secret joins the run's mask set before the first byte, and the server's output is held from now until the response headers say which cookie values to mask.
   * @param key - The action key.
   * @param ready - The server and endpoint ({@link OwnedNodeServerRun.assertReadyForRequest}).
   * @param secret - The password the learner typed in the editor's box.
   * @throws `REQUEST_NOT_CONFIRMED` without a secret; `LISTENER_NOT_OWNED`, `PORT_OWNER_UNKNOWN` or `RUN_NOT_READY` with `details.phase: "sign-in"` when refused before any byte (the run stays `ready`).
   */
  private async sendSignInRequest(
    key: string,
    ready: ReadyForRequest,
    secret: string | undefined,
  ): Promise<void> {
    const { signIn } = this.input.configuration
    if (!signIn) return
    if (secret === undefined || secret === '')
      throw new StudyError(
        'REQUEST_NOT_CONFIRMED',
        'The learner did not provide the sign-in password, so nothing was sent. The run stays ready.',
        undefined,
        undefined,
        undefined,
        { question: 'secret' },
      )
    const { host, port } = ready
    const declared = this.input.configuration.request
    const token = ++this.requestToken
    // Output is held before anything is learned, and the typed secret is masked before it is written.
    this.awaitingSignInHeaders = true
    this.requestPhase = 'sign-in'
    this.cookies = undefined
    this.signInStartedMs = this.clock.now()
    this.addSecrets([secret])
    this.signInView = { state: 'signing-in' }
    this.openRequestWindow(key, host, port, declared, { openHistory: false })
    const handle = this.startSender(
      token,
      this.senderInput(
        ready,
        {
          method: 'POST',
          path: signIn.path,
          contentType: 'application/json',
          body: buildSignInBody(signIn, secret),
        },
        { onSetCookie: (values) => this.onSignInHeaders(values, token) },
      ),
      'sign-in',
    )
    handle.response.then(
      (response) => void this.onSignInResponse(response, token),
      (error: unknown) => void this.onRequestError(error, token),
    )
    await this.awaitWritten(token, handle, undefined, 'sign-in')
  }

  /** The sign-in response headers arrived: the session's cookies and every form of their values join the mask set before the held output is published. */
  private onSignInHeaders(values: readonly string[], token: number): void {
    if (token !== this.requestToken || this.requestPhase !== 'sign-in') return
    this.cookies = applySetCookies(values, Date.now(), this.cookies)
    this.addSecrets(cookieMaskValues(this.cookies.seenValues))
    this.endOutputHold('release')
  }

  /** The sign-in response arrived: a session sends the declared request with its cookie, anything else ends the request. */
  private async onSignInResponse(
    response: NodeServerResponse,
    token: number,
  ): Promise<void> {
    if (token !== this.requestToken || !this.inRequestWindow()) return
    if (this.core.lifecycle !== 'live') return
    // A sender that reported no headers first still ends the hold: the response is the end of the exchange.
    this.endOutputHold('release')
    const { signIn } = this.input.configuration
    if (!signIn) return
    const cookies = this.cookies ?? applySetCookies([], Date.now())
    const outcome = signInOutcomeOf(response.status, cookies)
    if (outcome.kind === 'failed') {
      this.signInView = { state: 'failed', status: response.status }
      const message =
        outcome.reason === 'no-session-cookie'
          ? `The sign-in to ${signIn.path} answered HTTP ${response.status} without a session cookie, so the declared request was not sent.`
          : `The sign-in to ${signIn.path} was refused with HTTP ${response.status}, so the declared request was not sent.`
      this.input.history?.signIn(this.elapsedSinceLaunchMs(), {
        path: signIn.path,
        status: response.status,
        outcome: 'failed',
        code: 'NODE_SERVER_SIGN_IN_FAILED',
        durationMs: response.elapsedMs,
      })
      this.finishFailure('NODE_SERVER_SIGN_IN_FAILED', message, {
        status: response.status,
        reason: outcome.reason,
      })
      return
    }
    this.signInView = { state: 'signed-in', status: response.status }
    this.input.history?.signIn(this.elapsedSinceLaunchMs(), {
      path: signIn.path,
      status: response.status,
      outcome: 'signed-in',
      durationMs: response.elapsedMs,
    })
    this.requestPhase = 'request'
    this.notify()
    await this.sendDeclaredAfterSignIn(token, cookies)
  }

  /** Sends the declared request with the session cookie; every failure from here on ends the request (D14), and nothing is awaited by the receipt. */
  private async sendDeclaredAfterSignIn(
    token: number,
    cookies: SessionCookies,
  ): Promise<void> {
    const server = this.core.launched
    if (!this.address || !server || token !== this.requestToken) return
    const { host, port } = this.address
    const declared = this.input.configuration.request
    this.input.history?.openRequest(this.elapsedSinceLaunchMs(), {
      method: declared.method,
      path: declared.path,
      bodyBytes: Buffer.byteLength(declared.body ?? ''),
    })
    const cookie = cookieHeaderOf(cookies)
    let handle: ReturnType<NodeServerRunDependencies['sendRequest']>
    try {
      handle = this.dependencies.sendRequest(
        this.senderInput(
          { host, port, server },
          declared,
          // The response body may echo the session: the run's secrets are masked before it is cut.
          {
            sanitize: (text) =>
              this.maskText(hidePrivateRoots(text, this.core.privateRoots())),
            ...(cookie === undefined ? {} : { cookie }),
          },
        ),
      )
    } catch (error) {
      this.failRequest(
        'REQUEST_FAILED',
        `The request could not be started: ${sanitizeRunCause(error, this.input.workspace)}`,
      )
      return
    }
    handle.response.then(
      (response) => this.onResponse(response, token),
      (error: unknown) => void this.onRequestError(error, token),
    )
    try {
      await handle.written
      this.recordSentRequest(token)
    } catch {
      // The response promise rejects with the same error and ends the request.
    }
  }

  /** Opens the request window before any byte is written: the state reads `request-in-flight` and the limits run. */
  private openRequestWindow(
    key: string,
    host: ServerAddress['host'],
    port: number,
    declared: NodeServerConfiguration['request'],
    window: { openHistory: boolean } = { openHistory: true },
  ): void {
    this.requestAbort = new AbortController()
    this.requestEnded = false
    this.request = {
      key,
      method: declared.method,
      path: declared.path,
      bodyBytes: Buffer.byteLength(declared.body ?? ''),
      address: host === '::1' ? `[::1]:${port}` : `${host}:${port}`,
      sentAtMs: this.core.launched?.elapsedMs() ?? 0,
    }
    this.requestLimit.start()
    this.cancelWall = this.clock.set(
      () => this.timeOutRequest('wall-time'),
      NODE_SERVER_REQUEST_WALL_LIMIT_MS,
    )
    this.core.requireDebugger().setRequestWindow(true)
    // With sign-in the history opens the declared request after the sign-in entry.
    if (window.openHistory)
      this.input.history?.openRequest(this.elapsedSinceLaunchMs(), {
        method: declared.method,
        path: declared.path,
        bodyBytes: this.request.bodyBytes,
      })
    this.notify()
  }

  /** Milliseconds since the launch, the one clock every entry of the history carries; the seal reads it for the end entry's time. It stops moving once the run's end is known (a stop admitted, or the failure that ends the run). */
  elapsedSinceLaunchMs(): number {
    return this.core.elapsedSinceLaunchMs()
  }

  /** Journals the request once its bytes were handed to the socket, so a refused or stopped request never reads as sent. */
  private recordSentRequest(token: number): void {
    if (token !== this.requestToken || !this.request) return
    this.input.history?.markRequestSent(this.elapsedSinceLaunchMs())
    this.record('node-server.request', {
      method: this.request.method,
      path: this.request.path,
      bodyBytes: this.request.bodyBytes,
      address: this.request.address,
    })
  }

  /** Takes the window back when the request was refused before its bytes were written. */
  private closeRequestWindow(token: number, code = 'REQUEST_NOT_SENT'): void {
    if (token !== this.requestToken) return
    if (this.input.configuration.signIn) {
      // The sign-in sent nothing: the history opened no request, the output hold ends (nothing could have reached the server) and the run reads ready again.
      this.endOutputHold('release')
      this.signInView = { state: 'none' }
      this.requestPhase = 'request'
    } else {
      this.input.history?.withdrawRequest(this.elapsedSinceLaunchMs(), code)
    }
    this.requestToken += 1
    this.request = undefined
    this.requestLimit.stop()
    this.cancelWall?.()
    this.core.requireDebugger().setRequestWindow(false)
    this.notify()
  }

  /** Reads which process the connected socket reaches and refuses unless it is the launched server. */
  private async verifyPeer(
    connection: { localPort: number; remotePort: number },
    server: OwnedNodeProcess,
    port: number,
  ): Promise<void> {
    const holders = await this.dependencies.readConnectionServerPid({
      clientPort: connection.localPort,
      serverPort: connection.remotePort,
    })
    if (holders.length === 0)
      throw new StudyError(
        'PORT_OWNER_UNKNOWN',
        `Codebook could not read which process answers on port ${port}, so it sent nothing.`,
      )
    // Exactly the launched server may hold the connection's server end; a socket it shares with another process does not pass.
    const others = holders.filter((pid) => pid !== server.pid)
    if (others.length > 0)
      throw new StudyError(
        'LISTENER_NOT_OWNED',
        `Process ${others.join(', ')} answers on port ${port}, not the server Codebook started alone (process ${server.pid}); nothing was sent.`,
      )
  }

  /** The response arrived: it is the request's outcome. */
  private onResponse(response: NodeServerResponse, token: number): void {
    if (token !== this.requestToken || !this.inRequestWindow()) return
    if (this.core.lifecycle !== 'live') return
    this.response = response
    this.input.history?.response(this.elapsedSinceLaunchMs(), response)
    this.record('node-server.response', {
      status: response.status,
      contentType: response.contentType,
      body: response.body,
      bodyBytes: response.bodyBytes,
      readCut: response.readCut,
      location: response.location,
      elapsedMs: response.elapsedMs,
    })
    void this.endRequest()
  }

  /** The request failed: a reset is `REQUEST_FAILED` unless the server exited meanwhile, which is the run's failure. */
  private async onRequestError(error: unknown, token: number): Promise<void> {
    if (token !== this.requestToken || !this.inRequestWindow()) return
    if (this.core.lifecycle !== 'live') return
    const exit = await this.core.settledExit()
    if (exit && this.core.launched) {
      this.core.onServerExit(exit)
      return
    }
    if (token !== this.requestToken || !this.inRequestWindow()) return
    // After the sign-in the declared request's own peer check may refuse: the sign-in already changed the server, so the request ends (D14).
    if (
      this.input.configuration.signIn &&
      this.requestPhase === 'request' &&
      isRefusalBeforeAnyByte(error) &&
      error.code !== 'RUN_NOT_READY'
    ) {
      this.failRequest(error.code, error.message)
      return
    }
    this.failRequest(
      'REQUEST_FAILED',
      `The connection failed before a response: ${sanitizeRunCause(error, this.input.workspace)}`,
    )
  }

  /**
   * The request ran past a limit; each limit names itself in the message.
   * @param limit - `running-time` for the 30 s of running time (paused time excluded), `wall-time` for the 15-minute backstop (paused time included).
   */
  private timeOutRequest(limit: 'running-time' | 'wall-time'): void {
    this.failRequest(
      'REQUEST_TIMEOUT',
      limit === 'running-time'
        ? `The server did not answer within ${NODE_SERVER_REQUEST_TIMEOUT_MS / 1_000} s of running time.`
        : `The server did not answer within ${NODE_SERVER_REQUEST_WALL_LIMIT_MS / MS_PER_MINUTE} minutes of waiting, however long it was paused.`,
    )
  }

  /**
   * Ends the request with a failure that is its outcome, not the run's (D1). For a run with sign-in the failure names its phase, and a failure before the sign-in response is the sign-in's own history entry.
   * @param code - The failure's code.
   * @param message - The failure's sentence; the run's secret values are masked in it.
   */
  private failRequest(code: RequestFailureCode, message: string): void {
    if (!this.inRequestWindow() || this.core.lifecycle !== 'live') return
    const text = this.maskText(message)
    const { signIn } = this.input.configuration
    if (!signIn) {
      this.input.history?.failRequest(this.elapsedSinceLaunchMs(), code, text)
      this.finishFailure(code, text)
      return
    }
    const phase = this.requestPhase
    if (phase === 'sign-in') {
      // The exchange ended without a response: output held for a possible session value is dropped.
      this.endOutputHold('drop')
      this.signInView = { state: 'failed' }
      this.input.history?.signIn(this.elapsedSinceLaunchMs(), {
        path: signIn.path,
        status: null,
        outcome: 'failed',
        code,
        durationMs: Math.max(
          0,
          Math.round(this.clock.now() - this.signInStartedMs),
        ),
      })
    } else {
      this.input.history?.failRequest(this.elapsedSinceLaunchMs(), code, text)
    }
    this.finishFailure(code, text, { phase })
  }

  /** Keeps the failure as the request's outcome, journals it and ends the request's window. */
  private finishFailure(
    code: RequestFailureCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    this.requestFailure = { code, message, ...(details ? { details } : {}) }
    this.record('node-server.failure', {
      code,
      cause: message,
      ...(details ? { details } : {}),
    })
    this.requestAbort.abort(new Error(code))
    void this.endRequest()
  }

  /** The request ended: its window closes and every owned breakpoint is retired. */
  private async endRequest(): Promise<void> {
    this.requestEnded = true
    this.requestLimit.stop()
    this.cancelWall?.()
    this.core.debuggerSession?.setRequestWindow(false)
    this.notify()
    try {
      await this.core.debuggerSession?.retireStops(this.core.signal)
    } catch (error) {
      if (this.core.lifecycle === 'live')
        this.core.failRun(
          stepFailedError(
            'retiring the declared stops',
            error,
            this.input.workspace,
          ),
        )
    }
  }

  // ---------------------------------------------------------------- stop

  stop(): Promise<void> {
    return this.core.stop()
  }

  /** Reports a process that holds the declared port after the owned cleanup, apart from the stop's outcome. */
  private async reportForeignListener(): Promise<void> {
    const occupant = await this.dependencies
      .findPortOccupant(this.input.configuration.port)
      .catch(() => undefined)
    if (occupant)
      this.record('node-server.port-held-by-other', {
        port: this.input.configuration.port,
        pid: occupant.pid,
        command: occupant.command,
      })
  }
}

/**
 * Creates the run of one node-server declaration, to be prepared, sent a request, continued and stopped by the service.
 * Called by the environment's `createNodeServerRun` hook, which supplies the product's dependencies ({@link createProductNodeServerRunDependencies}); tests supply fakes.
 * @param input - The repository, the strictly parsed declaration, the event journal, the cited sources, the run id and the dependencies.
 * @returns The run, in state `preparing`; nothing is spawned until `prepare()` is called.
 * @example
 * const run = createOwnedNodeServerRun({ workspace, configuration, record, citedSources, runId, dependencies })
 * await run.prepare() // => resolves when run.view().state is 'ready'
 */
export function createOwnedNodeServerRun(
  input: NodeServerRunInput,
): NodeServerRuntime {
  return new OwnedNodeServerRun(input)
}
