import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'

import {
  NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  NODE_REPLAY_DEBUG_MAX_DEPTH,
  NODE_REPLAY_DEBUG_MAX_FRAMES,
  NODE_REPLAY_DEBUG_MAX_VARIABLES,
  NODE_SERVER_SESSION_NAME_PREFIX,
  NODE_TEST_ATTACH_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import type {
  NodeServerArmedStop,
  NodeServerDebugger,
  NodeServerDebuggerHandlers,
  NodeServerDebuggerInput,
  NodeServerDebuggerPause,
  NodeServerStopCapture,
  NodeServerStopTarget,
} from './nodeServerDebugger'
import {
  OwnedBreakpointMovedError,
  OwnedRepositoryBreakpoint,
} from './ownedRepositoryBreakpoint'
import { codebookStopLedger } from './runtimeSupport/codebookStopLedger'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { sha256 } from './runtimeSupport/utils/sha256'
import { WaitTimeoutError } from './runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments'
import { bindOwnedNodeTestDebugSession } from './utils/bindOwnedNodeTestDebugSession'
import { boundElsewhereRefusalText } from './utils/boundElsewhereRefusalText'
import {
  captureReplayDebugSnapshot,
  classificationLimitationOf,
} from './utils/captureReplayDebugSnapshot'
import { inspectNodeTestVariables } from './utils/inspectNodeTestVariables'
import { isDebugSessionOfRun } from './utils/isDebugSessionOfRun'
import { isDebugTargetSession } from './utils/isDebugTargetSession'
import { ownClosureScopePositionsOf } from './utils/ownClosureScopePositionsOf'
import { PendingResumeRequests } from './utils/pendingResumeRequests'
import { SharedAttempt } from './utils/sharedAttempt'
import { shouldCaptureReplayScope } from './utils/shouldCaptureReplayScope'
import { sourceImportBindings } from './utils/sourceImportBindings'
import { stoppedFunctionDeclaredNamesOf } from './utils/stoppedFunctionDeclaredNamesOf'
import { stopRunDebugSessions } from './utils/stopRunDebugSessions'

type StackBody = DebugProtocol.StackTraceResponse['body']

/** One `stopped` event of the bound session, in arrival order. */
type NativeStop = {
  token: number
  sessionId: string
  threadId: number
  reason: string
  hitBreakpointIds?: number[]
}

/** A declared stop with the owned breakpoint that arms it. */
type ArmedStop = {
  target: NodeServerStopTarget
  breakpoint: OwnedRepositoryBreakpoint
}

/**
 * The editor's side of a node-server run: a `pwa-node` attach to the server's announced inspector, the owned breakpoints of every declared stop, and the stop-tracking of the session.
 * Created by {@link createVscodeNodeServerDebugger} when the environment makes a run; it follows the stop-tracking of {@link OwnedNodeTestRun} (a tracker on the owned session, `stopped` and resume bookkeeping) and uses the stop ledger's windowed API so a stop the learner makes stays the learner's.
 */
class VscodeNodeServerDebugger implements NodeServerDebugger {
  private readonly name: string
  private readonly abort = new AbortController()
  private readonly active = new Map<string, vscode.DebugSession>()
  /** The threads the adapter reported stopped that have not run on since, by session. */
  private readonly pausedThreads = new Map<string, Set<number>>()
  private readonly sessionStops: NativeStop[] = []
  /** The bound session's stops queued for the run that it has not been told about yet, by token. */
  private readonly unreportedStops = new Map<number, NativeStop>()
  /** The resume requests waiting for the adapter's answer. */
  private readonly pendingResumes = new PendingResumeRequests()
  /** The pauses the run knows, by token, with the stack read when they were classified. */
  private readonly livePauses = new Map<
    number,
    { stop: NativeStop; trace: StackBody }
  >()
  private armed: ArmedStop[] = []
  private bound?: Awaited<ReturnType<typeof bindOwnedNodeTestDebugSession>>
  private handlers?: NodeServerDebuggerHandlers
  private entryReleased = false
  private entryToken?: number
  /** The runtime the attach named: a Bun launch maps Bun's source-map paths and copies its function scopes, which arrive as closures, into history. */
  private runtime: 'node' | 'bun' = 'node'
  private nextToken = 0
  private classification: Promise<void> = Promise.resolve()
  private releaseBegun = false
  private readonly releaser = new SharedAttempt(() => this.releaseOwned())
  private readonly tracker: vscode.Disposable
  private readonly termination: vscode.Disposable

  constructor(private readonly input: NodeServerDebuggerInput) {
    this.name = `${NODE_SERVER_SESSION_NAME_PREFIX}${input.runId}`
    this.tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker: (session) => {
        if (!this.owns(session)) return
        this.active.set(session.id, session)
        this.input.record('node-server.session-started', {
          sessionId: session.id,
        })
        return {
          onWillReceiveMessage: (message): void =>
            this.onClientMessage(session, message),
          onDidSendMessage: (message): void =>
            this.onAdapterMessage(session, message),
          onError: (error) =>
            this.input.record('node-server.debugger-error', {
              message: error.message,
            }),
        }
      },
    })
    this.termination = vscode.debug.onDidTerminateDebugSession((session) =>
      this.onSessionTerminated(session),
    )
  }

  /** Whether a session is this run's attach or a child of it. */
  private owns(session: vscode.DebugSession): boolean {
    return isDebugSessionOfRun(session, this.name)
  }

  /** Rejects work on a session that ended or was cancelled. */
  private assertActive(sessionId: string): void {
    if (this.releaseBegun || !this.active.has(sessionId))
      throw new Error(
        'Owned Node server debugger session terminated or was cancelled.',
      )
  }

  assertSourcesUnchanged(): void {
    assertConfiguredSourceDocuments(
      this.input.workspace,
      this.input.citedSources,
      vscode.workspace.textDocuments,
    )
  }

  subscribe(handlers: NodeServerDebuggerHandlers): { dispose(): void } {
    this.handlers = handlers
    return {
      dispose: (): void => {
        if (this.handlers === handlers) this.handlers = undefined
      },
    }
  }

  // ---------------------------------------------------------------- the editor's messages

  /** A request the editor sends the adapter: breakpoint bookkeeping, and a learner's pause or resume. */
  private onClientMessage(
    session: vscode.DebugSession,
    message: DebugProtocol.ProtocolMessage,
  ): void {
    if (message.type !== 'request') return
    const request = message as DebugProtocol.Request
    for (const { breakpoint } of this.armed)
      breakpoint.onRequest(session, request)
    // A pause request makes the next stop the learner's, not the declared request's.
    if (request.command === 'pause')
      codebookStopLedger.closeWindow([session.id])
    // Whether the thread runs on is the adapter's answer: a rejected resume leaves it paused.
    this.pendingResumes.noteRequest(session.id, request)
  }

  /** A message the adapter sends: replies and news for the breakpoints, a `continued` and a `stopped`. */
  private onAdapterMessage(
    session: vscode.DebugSession,
    message: DebugProtocol.ProtocolMessage,
  ): void {
    if (message.type === 'response') {
      const response = message as DebugProtocol.Response
      for (const { breakpoint } of this.armed)
        breakpoint.onResponse(session, response)
      this.onResumeAnswered(session.id, response)
    }
    if (message.type !== 'event') return
    const event = message as DebugProtocol.Event
    if (event.event === 'breakpoint')
      for (const { breakpoint } of this.armed)
        breakpoint.onEvent(session, event)
    if (event.event === 'continued') {
      const continued = (event as DebugProtocol.ContinuedEvent).body
      // Omitted or true, every thread of the session ran on.
      this.resumeThreads(
        session.id,
        continued.allThreadsContinued === false
          ? continued.threadId
          : undefined,
      )
    }
    if (event.event === 'stopped')
      this.onStopped(session, (event as DebugProtocol.StoppedEvent).body)
  }

  /** The adapter reports a stop: it is remembered, and reported to the run once the entry pause is released. */
  private onStopped(
    session: vscode.DebugSession,
    body: DebugProtocol.StoppedEvent['body'],
  ): void {
    if (!Number.isInteger(body.threadId)) return
    const threads = this.pausedThreads.get(session.id) ?? new Set<number>()
    threads.add(body.threadId!)
    this.pausedThreads.set(session.id, threads)
    // Each stop gets the next number, so a classification never answers a later stop.
    const sequence = ++this.nextToken
    const stop: NativeStop = {
      token: sequence,
      sessionId: session.id,
      threadId: body.threadId!,
      reason: body.reason,
      hitBreakpointIds: Array.isArray(body.hitBreakpointIds)
        ? body.hitBreakpointIds.filter((id) => Number.isInteger(id))
        : undefined,
    }
    this.sessionStops.push(stop)
    this.input.record('node-server.dap-stopped', {
      sessionId: session.id,
      threadId: stop.threadId,
      reason: stop.reason,
    })
    if (!this.entryReleased) return
    // Once the release began, a stop of the bound session goes to the run at once: the detach's `continued` can follow in the same turn and would drop it from the classification queue before the run ends the group.
    if (this.releaseBegun && stop.sessionId === this.bound?.session.id) {
      this.reportStopDuringRelease(stop)
      return
    }
    this.enqueueClassification(stop)
  }

  /**
   * Reports a stop of the bound session that arrived after the release began, in the turn it arrived: its stack is not read (the release aborted the reads), so it counts as no declared stop, and the run ends the group before the detach resumes the paused code.
   * Called by {@link onStopped} after the release began.
   * @param stop - The adapter's stop.
   * @example this.reportStopDuringRelease(stop) // the run's onPause hears it with no declared stop index
   */
  private reportStopDuringRelease(stop: NativeStop): void {
    codebookStopLedger.recordStop(stop.sessionId, false)
    this.livePauses.set(stop.token, { stop, trace: { stackFrames: [] } })
    this.handlers?.onPause({
      token: stop.token,
      sessionId: stop.sessionId,
      threadId: stop.threadId,
      reason: stop.reason,
      declaredStopIndex: undefined,
      location: undefined,
    })
  }

  /** The adapter answered a resume request: an accepted one lets its thread, or every thread, run on; a rejected one leaves the pause as it was. */
  private onResumeAnswered(
    sessionId: string,
    response: DebugProtocol.Response,
  ): void {
    const ranOn = this.pendingResumes.takeAnswered(sessionId, response)
    if (ranOn) this.resumeThreads(sessionId, ranOn.threadId)
  }

  /**
   * Records that paused threads ran on (Codebook's resume, the learner's Continue or a step, the adapter's own continue) and reports each reported pause among them to the run.
   * @param sessionId - The session whose threads ran on.
   * @param threadId - The one thread that ran on; `undefined` for every thread of the session.
   */
  private resumeThreads(sessionId: string, threadId?: number): void {
    const ranOn = (stop: NativeStop): boolean =>
      stop.sessionId === sessionId &&
      (threadId === undefined || stop.threadId === threadId)
    if (threadId === undefined) this.pausedThreads.delete(sessionId)
    else this.pausedThreads.get(sessionId)?.delete(threadId)
    // A stop that ran on is no pause any more: the release, which hands the session's earlier stops to the run, must not report it (a Bun target runs before its release).
    for (let index = this.sessionStops.length - 1; index >= 0; index -= 1)
      if (ranOn(this.sessionStops[index]!)) this.sessionStops.splice(index, 1)
    for (const [token, stop] of this.unreportedStops)
      if (ranOn(stop)) this.unreportedStops.delete(token)
    for (const [token, { stop }] of this.livePauses)
      if (ranOn(stop)) {
        this.livePauses.delete(token)
        this.handlers?.onResume(token)
      }
  }

  /** Whether the adapter reported the thread stopped and it has not run on since. */
  private isThreadPaused(sessionId: string, threadId: number): boolean {
    return this.pausedThreads.get(sessionId)?.has(threadId) === true
  }

  hasUnreportedPause(): boolean {
    return this.unreportedStops.size > 0
  }

  private onSessionTerminated(session: vscode.DebugSession): void {
    this.pausedThreads.delete(session.id)
    // An ended session holds no target, so none of its stops can be paused any more.
    for (const [token, stop] of this.unreportedStops)
      if (stop.sessionId === session.id) this.unreportedStops.delete(token)
    codebookStopLedger.forget(session.id)
    this.pendingResumes.forgetSession(session.id)
    if (!this.active.delete(session.id)) return
    this.input.record('node-server.session-terminated', {
      sessionId: session.id,
    })
    if (!this.releaseBegun && session.id === this.bound?.session.id)
      this.handlers?.onEnd('the debug session was terminated')
  }

  // ---------------------------------------------------------------- attach

  async attach(input: {
    endpoint: string
    packageRoot: string
    pid: number
    processGroup: number
    signal: AbortSignal
    runtime?: 'node' | 'bun'
  }): Promise<void> {
    const { workspace, runId } = this.input
    this.runtime = input.runtime ?? 'node'
    const started = await vscode.debug.startDebugging(
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace)),
      {
        name: this.name,
        type: 'pwa-node',
        request: 'attach',
        websocketAddress: input.endpoint,
        cwd: workspace,
        restart: false,
        autoAttachChildProcesses: false,
        continueOnAttach: false,
        sourceMaps: true,
        // Bun's inline source maps name each file from the folder Bun started in (`/src/index.ts`), which is the package root's real path.
        ...(this.runtime === 'bun'
          ? { sourceMapPathOverrides: { '/*': `${input.packageRoot}/*` } }
          : {}),
        timeout: NODE_TEST_ATTACH_TIMEOUT_MS,
      },
      // The editor would save the learner's modified documents as the session starts; a learner's document is saved by the learner alone.
      { suppressSaveBeforeStart: true },
    )
    input.signal.throwIfAborted()
    if (!started)
      throw new Error('The native Node debugger refused the owned attach.')
    this.bound = await waitUntil(
      () => this.bindFirstOwnedSession(input, runId),
      'owned native Node server debugger',
      NODE_TEST_ATTACH_TIMEOUT_MS,
      input.signal,
    )
    if (this.bound.identity.pid !== input.pid)
      throw new Error(
        'The debugger attached to another process than the launched server.',
      )
  }

  /** Binds the first session of this run whose inspector belongs to the launched server; a session that does not match yet is tried again. */
  private async bindFirstOwnedSession(
    input: { packageRoot: string; processGroup: number; signal: AbortSignal },
    runId: string,
  ) {
    for (const session of this.active.values()) {
      // A session without a parent is taken as js-debug's target-less attach root and never asked (its requestCDPProxy never answers).
      if (!isDebugTargetSession(session)) continue
      try {
        return await bindOwnedNodeTestDebugSession(
          session,
          runId,
          input.packageRoot,
          input.processGroup,
          input.signal,
          (sessionId) => this.assertActive(sessionId),
          this.name,
        )
      } catch (error) {
        if (input.signal.aborted) throw error
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------- arming and the entry pause

  async armStops(
    stops: NodeServerStopTarget[],
    signal: AbortSignal,
  ): Promise<NodeServerArmedStop[]> {
    const session = this.boundSession()
    // Every stop is requested before any acknowledgement is awaited.
    this.armed = stops.map((target) => ({
      target,
      breakpoint: new OwnedRepositoryBreakpoint(
        target.file,
        target.line,
        target.column,
      ),
    }))
    const armedStops: NodeServerArmedStop[] = []
    for (const { target, breakpoint } of this.armed) {
      const receipt = await this.registeredAsDeclared(
        breakpoint,
        target,
        session,
        signal,
      )
      // A pending reply names no place yet, so the adapter is asked once more while the server is still paused.
      if (receipt.status === 'pending')
        await breakpoint.assertBoundAsDeclared(session, signal)
      armedStops.push({
        declaredStopIndex: target.declaredStopIndex,
        breakpointId: receipt.breakpointId,
        boundLine: await this.boundLineOf(breakpoint, session, signal),
      })
    }
    return armedStops
  }

  /**
   * Reads the line a freshly armed stop is bound to. A Bun run arms once the server listens, so a registration still pending is waited for until it verifies or the arming deadline passes; a node run arms before its files load and takes a pending stop as it is.
   * @param breakpoint - The armed stop's breakpoint.
   * @param session - The bound session.
   * @param signal - The arming's cancellation and deadline.
   * @returns The verified line (a reply without a column counts); `undefined` while the stop is unverified.
   * @throws The abort reason when the run itself ended the arming (an exit or a failure); the arming deadline is no throw, it leaves the stop unbound.
   * @example await this.boundLineOf(breakpoint, session, signal) // => 14
   */
  private async boundLineOf(
    breakpoint: OwnedRepositoryBreakpoint,
    session: vscode.DebugSession,
    signal: AbortSignal,
  ): Promise<number | undefined> {
    const now = breakpoint.boundPlace(session)?.line
    if (now !== undefined || this.runtime !== 'bun') return now
    try {
      const place = await waitUntil(
        () => breakpoint.boundPlace(session),
        'the arming of a declared stop',
        NODE_TEST_ATTACH_TIMEOUT_MS,
        signal,
      )
      return place.line
    } catch (error) {
      // The arming deadline (the wait's own budget or the signal's timeout) leaves the stop unbound; any other end belongs to the run.
      const isDeadline =
        error instanceof WaitTimeoutError ||
        (error instanceof DOMException && error.name === 'TimeoutError')
      if (isDeadline) return undefined
      throw error
    }
  }

  /**
   * Re-reads where every armed stop stands now, so the run can refuse a stop the adapter withdrew after it verified it; called by the run right before it is marked prepared.
   * @returns One entry per armed stop; `boundLine` is absent for a stop that is no longer verified.
   * @example this.currentlyBoundStops() // => [{ declaredStopIndex: 0, boundLine: 14 }, { declaredStopIndex: 1 }]
   */
  currentlyBoundStops(): NodeServerArmedStop[] {
    const session = this.boundSession()
    return this.armed.map(({ target, breakpoint }) => ({
      declaredStopIndex: target.declaredStopIndex,
      boundLine: breakpoint.boundPlace(session)?.line,
    }))
  }

  /** Waits for the adapter's acknowledgement of one stop; a stop it moved to another place is refused with the sentence of both positions. */
  private async registeredAsDeclared(
    breakpoint: OwnedRepositoryBreakpoint,
    target: NodeServerStopTarget,
    session: vscode.DebugSession,
    signal: AbortSignal,
  ) {
    try {
      return await breakpoint.registered(session, signal)
    } catch (error) {
      // The adapter's reply or later news put the stop elsewhere: the sentence names both places.
      const place =
        error instanceof OwnedBreakpointMovedError
          ? error.place
          : breakpoint.refusedPlace(session)
      if (!place) throw error
      throw new Error(
        boundElsewhereRefusalText(
          { line: target.line, column: target.column },
          place,
        ),
      )
    }
  }

  /** The bound session; arming before the attach is a mistake of the run. */
  private boundSession(): vscode.DebugSession {
    if (!this.bound) throw new Error('The debugger is not attached yet.')
    return this.bound.session
  }

  async releaseEntry(
    signal: AbortSignal,
    options: { entryPause: boolean } = { entryPause: true },
  ): Promise<void> {
    const session = this.boundSession()
    // A Bun launch has no paused entry to continue: every stop from here on goes to the run.
    if (!options.entryPause) {
      this.entryToken = undefined
      this.entryReleased = true
      for (const stop of this.sessionStops) this.enqueueClassification(stop)
      return
    }
    const first = await waitUntil(
      () => this.sessionStops.find((stop) => stop.sessionId === session.id),
      'the entry pause of the server',
      NODE_TEST_ATTACH_TIMEOUT_MS,
      signal,
    )
    // A declared stop hit before any entry pause (its file is the entry itself) is a hit, not the entry.
    const isEntry = this.ownedHitIndexOf(first, session) === undefined
    this.entryToken = isEntry ? first.token : undefined
    this.entryReleased = true
    for (const stop of this.sessionStops)
      if (stop.token !== this.entryToken) this.enqueueClassification(stop)
    if (isEntry)
      // The entry pause is continued exactly once.
      await awaitResponse(
        session.customRequest('continue', { threadId: first.threadId }),
        'the entry continuation',
        signal,
      )
  }

  // ---------------------------------------------------------------- classification of pauses

  /** Reads one stop's stack and reports it to the run, in arrival order; a stop of the bound session counts as unreported until then. */
  private enqueueClassification(stop: NativeStop): void {
    if (stop.sessionId === this.bound?.session.id)
      this.unreportedStops.set(stop.token, stop)
    this.classification = this.classification
      .then(() => this.classifyAndReport(stop))
      .catch((error: unknown) => {
        this.input.record('node-server.debugger-error', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  /**
   * Reads the paused stack of a stop. A stack that cannot be read leaves an empty one: the pause is then reported as a pause that is no declared stop, so the run holds it and never lets a stop resume code it could not classify.
   * @param session - The bound session.
   * @param stop - The adapter's stop.
   * @returns The stack, or an empty one when the adapter failed to answer.
   */
  private async readStack(
    session: vscode.DebugSession,
    stop: NativeStop,
  ): Promise<StackBody> {
    try {
      return (await awaitResponse(
        session.customRequest('stackTrace', {
          threadId: stop.threadId,
          startFrame: 0,
          levels: NODE_REPLAY_DEBUG_MAX_FRAMES,
        }),
        'the paused stack',
        this.abort.signal,
      )) as StackBody
    } catch (error) {
      this.input.record('node-server.debugger-error', {
        message: error instanceof Error ? error.message : String(error),
      })
      return { stackFrames: [] }
    }
  }

  private async classifyAndReport(stop: NativeStop): Promise<void> {
    const session = this.active.get(stop.sessionId)
    // Only the bound session's pauses are the run's; a child session's stop is not reported. A stop queued before the release began is reported too, so the run can end the group before the detach resumes it.
    if (!session || session.id !== this.bound?.session.id) return
    // Once the release began the stack is not read (its requests are aborted): the pause is reported as no declared stop.
    const trace = this.releaseBegun
      ? { stackFrames: [] }
      : await this.readStack(session, stop)
    // A stop whose thread ran on while its stack was read is no pause any more, even if the thread stopped again since.
    if (!this.unreportedStops.has(stop.token)) return
    const frame = trace.stackFrames[0]
    // Without a readable top frame the hit cannot be verified, so it is no declared stop.
    const declaredStopIndex = frame
      ? this.ownedHitIndexOf(stop, session, frame)
      : undefined
    // Inside the request's window an owned hit is Codebook's stop; every other stop stays the learner's.
    codebookStopLedger.recordStop(
      session.id,
      declaredStopIndex !== undefined &&
        codebookStopLedger.isWindowOpen(session.id),
    )
    this.livePauses.set(stop.token, { stop, trace })
    this.unreportedStops.delete(stop.token)
    this.handlers?.onPause({
      token: stop.token,
      sessionId: stop.sessionId,
      threadId: stop.threadId,
      reason: stop.reason,
      declaredStopIndex,
      location: this.locationOf(frame),
    })
  }

  /**
   * Tells whether a stop is the hit of an armed declared stop: its reason is `breakpoint`, the adapter names the owned breakpoint's id, and the top frame stands in the stop's file on its verified line (on the declared line while the registration is pending).
   * A Bun target's stop that names no id is judged by its place alone: js-debug handles a Bun module's first pause as that module's entry pause (Bun has no instrumentation breakpoint), rewrites it as a plain breakpoint and drops the hit ids (Cycle 0152 N0), so an armed stop's own hit arrives without them.
   * @param stop - The adapter's stop.
   * @param session - The bound session.
   * @param frame - The top frame; without one only the ids decide (the entry check).
   * @returns The declared stop index, or `undefined` for every other pause.
   * @example this.ownedHitIndexOf(stop, session, frame) // => 1 for a hit of the second declared stop
   */
  private ownedHitIndexOf(
    stop: NativeStop,
    session: vscode.DebugSession,
    frame?: DebugProtocol.StackFrame,
  ): number | undefined {
    if (stop.reason !== 'breakpoint') return undefined
    const hitIds = stop.hitBreakpointIds
    // A Bun stop without ids is judged by its place alone, which always needs the frame.
    if (this.runtime === 'bun' && !hitIds?.length)
      return frame ? this.armedStopAtFrame(session, frame) : undefined
    if (!hitIds) return undefined
    for (const { target, breakpoint } of this.armed) {
      const id = breakpoint.acknowledgedId(session)
      // An unbound stop is never hit; only the stop whose id the adapter names can be.
      if (id === undefined || !hitIds.includes(id)) continue
      const line = breakpoint.verifiedPlace(session)?.line ?? target.line
      const isAtStop =
        frame?.source?.path === target.file && frame.line === line
      // Without a frame only the ids decide (the entry check).
      if (isAtStop || !frame) return target.declaredStopIndex
    }
    return undefined
  }

  /**
   * Finds the one armed stop an ID-less Bun pause is, by its place: the stop's file, its verified line and, when the verified place has a column, that column.
   * Why it exists: two stops may share a line (14:3 and 14:24) and a pause that names no id cannot be told between them by the line alone; an ambiguous or unmatched pause stays the learner's. Only a stop with a current verified binding is a candidate.
   * Called by {@link ownedHitIndexOf}.
   * @param session - The bound session.
   * @param frame - The top frame of the pause.
   * @returns The declared stop index when exactly one armed stop matches; `undefined` for none or several.
   * @example this.armedStopAtFrame(session, { line: 14, column: 24, source: { path: file } }) // => 1 for stops at 14:3 and 14:24
   */
  private armedStopAtFrame(
    session: vscode.DebugSession,
    frame: DebugProtocol.StackFrame,
  ): number | undefined {
    const matches = this.armed.filter(({ target, breakpoint }) => {
      const place = breakpoint.boundPlace(session)
      return (
        place !== undefined &&
        frame.source?.path === target.file &&
        frame.line === place.line &&
        // A verified place without a column matches any column of its line.
        (place.column === undefined || frame.column === place.column)
      )
    })
    return matches.length === 1
      ? matches[0]?.target.declaredStopIndex
      : undefined
  }

  /** Names the top frame for an event: the repository-relative path inside the repository, the file name alone outside it. */
  private locationOf(
    frame: DebugProtocol.StackFrame | undefined,
  ): { path: string; line: number } | undefined {
    const path = frame?.source?.path
    if (!frame || path === undefined) return undefined
    const inside = relative(this.input.workspace, path)
    return {
      path:
        inside && !inside.startsWith('..') && !isAbsolute(inside)
          ? inside
          : basename(path),
      line: frame.line,
    }
  }

  setRequestWindow(open: boolean): void {
    const sessionId = this.bound?.session.id
    if (!sessionId) return
    if (open) codebookStopLedger.openWindow([sessionId])
    else codebookStopLedger.closeWindow([sessionId])
  }

  // ---------------------------------------------------------------- capture and resume

  async capture(
    pause: NodeServerDebuggerPause,
    signal: AbortSignal,
  ): Promise<NodeServerStopCapture> {
    const live = this.livePauses.get(pause.token)
    const armed = this.armed.find(
      ({ target }) => target.declaredStopIndex === pause.declaredStopIndex,
    )
    const session = this.active.get(pause.sessionId)
    const frame = live?.trace.stackFrames[0]
    if (!live || !armed || !session || !frame)
      throw new Error('The owned pause is no longer current.')
    const { target } = armed
    const assertCurrent = (): void => {
      this.assertActive(session.id)
      if (!this.livePauses.has(pause.token))
        throw new Error('The owned pause changed during the capture.')
    }
    const scopes = (await awaitResponse(
      session.customRequest('scopes', { frameId: frame.id }),
      "the stop's scopes",
      signal,
    )) as DebugProtocol.ScopesResponse['body']
    // The stopped module's imports tell which export each imported name reads; this first read is verified by the second one below.
    const firstRead = await readFile(target.file)
    // A Bun stop decides once which closures are the stopped function's own; the declared inspections and the replay snapshot below both use that decision. A Node run reads every non-global scope, as before.
    const bunScopes =
      this.runtime === 'bun'
        ? await this.ownBunScopesOf(
            session,
            scopes.scopes,
            frame,
            firstRead.toString('utf8'),
            signal,
            assertCurrent,
          )
        : undefined
    const inspected = await inspectNodeTestVariables(
      session,
      bunScopes?.inspectable ?? scopes.scopes,
      target.inspections,
      sourceImportBindings(firstRead.toString('utf8')),
      signal,
    )
    assertCurrent()
    const sourceBytes = await readFile(target.file)
    assertCurrent()
    this.assertSourceIsCited(target, firstRead, sourceBytes)
    const snapshot = await captureReplayDebugSnapshot({
      stack: live.trace,
      verifiedSource: {
        name: target.path,
        text: sourceBytes.toString('utf8'),
        hash: target.hash,
        line: frame.line,
      },
      request: (command, arguments_) =>
        session.customRequest(command, arguments_),
      assertCurrent,
      signal,
      workspaceRoot: this.input.workspace,
      // Masked before the snapshot's cut, so a secret straddling it leaves no fragment; read at call time.
      maskKnownText: (text) => this.input.maskKnownText?.(text) ?? text,
      // Bun reports the stopped function's own scopes as closures; the capture copies one only when the stopped function's own source declares every name in it.
      ...(bunScopes
        ? { bunClosures: true as const, ownClosurePositions: bunScopes.own }
        : {}),
      limits: {
        timeoutMs: NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
        maxFrames: NODE_REPLAY_DEBUG_MAX_FRAMES,
        maxVariables: NODE_REPLAY_DEBUG_MAX_VARIABLES,
        maxDepth: NODE_REPLAY_DEBUG_MAX_DEPTH,
      },
    })
    assertCurrent()
    if (bunScopes?.limitation) snapshot.limitations.push(bunScopes.limitation)
    for (const fact of inspected.unavailable)
      snapshot.limitations.push(
        `Required fact ${fact} could not be read at this stop.`,
      )
    return {
      path: target.path,
      line: frame.line,
      column: frame.column,
      frameName: frame.name,
      sourceHash: target.hash,
      facts: inspected.facts,
      unavailable: inspected.unavailable,
      snapshot,
    }
  }

  /**
   * Decides, once per Bun stop, which of the stopped frame's scopes are the stopped function's own: its block scopes and the closures {@link ownClosureScopePositionsOf} accepts.
   * Why it exists: the replay snapshot copies only those scopes, so a declared inspection that read an enclosing factory's closure would save in `facts` a value the Variables snapshot leaves out; both reads now share this decision.
   * Called by {@link VscodeNodeServerDebugger.capture} for a Bun run only; a Node run keeps reading every non-global scope.
   * @param session - The bound session.
   * @param scopes - The top frame's scopes, innermost first.
   * @param frame - The top frame.
   * @param sourceText - The stopped file's text (verified against the cited hash by the caller afterwards).
   * @param signal - Run cancellation.
   * @param assertCurrent - Throws when the pause is no longer current.
   * @returns `own`, the positions of the own closures; `inspectable`, the scopes a declared inspection may read; `limitation`, set when the classification read failed (no closure is own then).
   * @example await this.ownBunScopesOf(session, scopes, frame, text, signal, assertCurrent) // => { own: Set { 0 }, inspectable: [...], limitation: undefined }
   */
  private async ownBunScopesOf(
    session: vscode.DebugSession,
    scopes: DebugProtocol.Scope[],
    frame: DebugProtocol.StackFrame,
    sourceText: string,
    signal: AbortSignal,
    assertCurrent: () => void,
  ): Promise<{
    own: ReadonlySet<number>
    inspectable: DebugProtocol.Scope[]
    limitation?: string
  }> {
    let own: ReadonlySet<number> = new Set<number>()
    let limitation: string | undefined
    try {
      own = await ownClosureScopePositionsOf(
        scopes,
        async (variablesReference) => {
          const body = (await awaitResponse(
            session.customRequest('variables', {
              variablesReference,
              start: 0,
              // One name more than the limit tells the scope is too large.
              count: NODE_REPLAY_DEBUG_MAX_VARIABLES + 1,
            }),
            "a closure scope's names",
            signal,
          )) as DebugProtocol.VariablesResponse['body']
          return body.variables.map((variable) => variable.name)
        },
        stoppedFunctionDeclaredNamesOf(sourceText, frame.line, frame.column),
        frame.name,
        NODE_REPLAY_DEBUG_MAX_VARIABLES,
      )
    } catch (error) {
      // A resume or cancellation still ends the capture; any other failed read leaves no closure own, so nothing of one is read or saved.
      assertCurrent()
      signal.throwIfAborted()
      limitation = classificationLimitationOf(
        error instanceof Error ? error.message : String(error),
      )
    }
    return {
      own,
      // Block scopes plus own closures, exactly what the snapshot copies for the stopped frame.
      inspectable: scopes.filter(
        (scope, position) =>
          own.has(position) ||
          shouldCaptureReplayScope(0, scope.name, scope.presentationHint),
      ),
      ...(limitation !== undefined && { limitation }),
    }
  }

  /** Both reads of the stop's file must be the cited bytes, and the editor must hold no other text for a cited source. */
  private assertSourceIsCited(
    target: NodeServerStopTarget,
    firstRead: Buffer,
    secondRead: Buffer,
  ): void {
    if (sha256(firstRead) !== target.hash || sha256(secondRead) !== target.hash)
      throw new StudyError(
        'SOURCE_CHANGED',
        `The cited source ${target.path} changed on disk while its stop was captured. Read the source again, publish the article again and start a new run.`,
      )
    this.assertSourcesUnchanged()
  }

  async resume(
    pause: NodeServerDebuggerPause,
    signal: AbortSignal,
  ): Promise<void> {
    const session = this.active.get(pause.sessionId)
    if (!session || !this.isThreadPaused(pause.sessionId, pause.threadId))
      throw new Error('The owned pause is no longer current.')
    await awaitResponse(
      session.customRequest('continue', { threadId: pause.threadId }),
      'the continuation',
      signal,
    )
  }

  async retireStops(signal: AbortSignal): Promise<void> {
    const session = this.boundSession()
    // One after the other: each retirement waits for the adapter's reply that excludes it.
    for (const { breakpoint } of this.armed)
      await breakpoint.retire(session, signal)
  }

  // ---------------------------------------------------------------- release

  release(): Promise<void> {
    // A failed release is dropped, so the next stop runs it again.
    return this.releaser.run()
  }

  /** Removes the breakpoints, ends the sessions this run started and stops listening; run again after a failure, so each step can repeat. */
  private async releaseOwned(): Promise<void> {
    this.releaseBegun = true
    this.abort.abort()
    this.bound?.cdp.close()
    for (const { breakpoint } of this.armed) breakpoint.remove()
    await stopRunDebugSessions([...this.active.values()], (session) =>
      vscode.debug.stopDebugging(session),
    )
    // Only a release that succeeded stops hearing of sessions.
    this.tracker.dispose()
    this.termination.dispose()
  }
}

/**
 * Creates the editor-backed debugger of one node-server run.
 * Called by the node-server run's dependencies (`createDebugger`) at the start of the run's preparation; nothing attaches until the run calls `attach`.
 * @param input - The run id (it names the debug session), the repository, the cited sources, the declared stops and the event journal.
 * @returns The debugger, listening to the editor's debug sessions of this run only.
 * @example
 * const debug = createVscodeNodeServerDebugger({ runId, workspace, citedSources, stops, record })
 * await debug.attach({ endpoint, packageRoot, pid, processGroup, signal })
 */
export function createVscodeNodeServerDebugger(
  input: NodeServerDebuggerInput,
): NodeServerDebugger {
  return new VscodeNodeServerDebugger(input)
}
