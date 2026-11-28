import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

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
import { captureReplayDebugSnapshot } from './utils/captureReplayDebugSnapshot'
import { inspectNodeTestVariables } from './utils/inspectNodeTestVariables'
import { isDebugSessionOfRun } from './utils/isDebugSessionOfRun'
import { isDebugTargetSession } from './utils/isDebugTargetSession'
import { PendingResumeRequests } from './utils/pendingResumeRequests'
import { SharedAttempt } from './utils/sharedAttempt'
import { sourceImportBindings } from './utils/sourceImportBindings'
import { stopRunDebugSessions } from './utils/stopRunDebugSessions'

type StackBody = DebugProtocol.StackTraceResponse['body']

/** One `stopped` event of the bound session, in arrival order. */
type NativeStop = {
  token: number
  sessionId: string
  threadId: number
  reason: string
  hitBreakpointIds?: number[]
  /** Whether the request window was open when the adapter's `stopped` arrived, so a classification that finishes later still tells a pause before the request from one it caused. Absent for a run that does not judge its stops by the arrival window ({@link NodeServerDebuggerInput.stopsJudgedByArrivalWindow}). */
  inRequestWindowAtStop?: boolean
  /** Whether the open window belonged to the sign-in request when the adapter's `stopped` arrived; present with `inRequestWindowAtStop`. */
  inSignInAtStop?: boolean
  /** A Bun run: the learner's enabled source breakpoints (none of the run's own) as the editor listed them when the adapter's `stopped` arrived, so a breakpoint removed while the stack was read still counts as a possible cause. */
  learnerBreakpoints?: LearnerBreakpointPlace[]
}

/** The place of one breakpoint the learner set: the resolved file path and the one-based line. */
type LearnerBreakpointPlace = { file: string; line: number }

/** One `pause` request of the editor (the learner's Pause), until the first stop after its acceptance settles it. */
type LearnerPauseRequest = {
  sessionId: string
  /** Whether the adapter accepted the request; an unanswered request is not accepted yet. */
  accepted: boolean
}

/** A declared stop with the owned breakpoint that arms it. */
type ArmedStop = {
  target: NodeServerStopTarget
  breakpoint: OwnedRepositoryBreakpoint
}

/**
 * Tells whether something an arming wait ended with is the arming deadline (the wait's own budget or the signal's timeout) rather than the run ending the arming.
 * Called by {@link VscodeNodeServerDebugger.armStops} and its helpers for a Bun run's late arming.
 * @param reason - The error a wait threw, or the arming signal's abort reason.
 * @returns `true` for a {@link WaitTimeoutError} or a `TimeoutError` DOMException; `false` for anything else.
 * @example isArmingDeadline(new DOMException('x', 'TimeoutError')) // => true
 */
function isArmingDeadline(reason: unknown): boolean {
  return (
    reason instanceof WaitTimeoutError ||
    (reason instanceof DOMException && reason.name === 'TimeoutError')
  )
}

/**
 * The editor's side of a node-server run: a `pwa-node` attach to the server's announced inspector, the owned breakpoints of every declared stop, and the stop-tracking of the session.
 * Created by {@link createVscodeNodeServerDebugger} when the environment makes a run; it follows the stop-tracking of {@link OwnedNodeTestRun} (a tracker on the owned session, `stopped` and resume bookkeeping) and uses the stop ledger's windowed API so a stop the learner makes stays the learner's.
 */
class VscodeNodeServerDebugger implements NodeServerDebugger {
  private readonly name: string
  private readonly abort = new AbortController()
  private readonly active = new Map<string, vscode.DebugSession>()
  /** The threads the adapter reported stopped that have not run on since, by session, each with the token of its newest stop (the only pause of the thread that a resume may still name). */
  private readonly pausedThreads = new Map<string, Map<number, number>>()
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
  /** The learner's pause stops (the first stop of a session after an accepted editor `pause` request, whatever its reason) that have not run on, by token; the run's window opens again once none is held. */
  private readonly learnerPauseStops = new Map<number, NativeStop>()
  /** The editor's `pause` requests that are unanswered or accepted without a stop yet, as `<session id>:<request sequence>`, in the order they were sent; a refusal removes only its own request. */
  private readonly learnerPauseRequests = new Map<string, LearnerPauseRequest>()
  /** Whether the run meant its request window to be open ({@link setRequestWindow}), whatever a learner's pause did to the ledger since. */
  private requestWindowIntendedOpen = false
  /** Whether the window the run meant open belongs to the sign-in request, so a stop that arrives in it is the sign-in's. */
  private requestWindowIsSignIn = false
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
    if (request.command === 'pause') {
      codebookStopLedger.closeWindow([session.id])
      this.learnerPauseRequests.set(`${session.id}:${request.seq}`, {
        sessionId: session.id,
        accepted: false,
      })
    }
    // Whether the thread runs on is the adapter's answer: a rejected resume leaves it paused.
    // The request resumes only the stops that exist now: a stop that arrives before its answer is a later pause.
    this.pendingResumes.noteRequest(session.id, request, this.nextToken)
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
      this.onLearnerPauseAnswered(session.id, response)
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
    // Each stop gets the next number, so a classification never answers a later stop.
    const sequence = ++this.nextToken
    const threads =
      this.pausedThreads.get(session.id) ?? new Map<number, number>()
    // The thread's newest stop is the only pause a resume may still name.
    threads.set(body.threadId!, sequence)
    this.pausedThreads.set(session.id, threads)
    const stop: NativeStop = {
      token: sequence,
      sessionId: session.id,
      threadId: body.threadId!,
      reason: body.reason,
      hitBreakpointIds: Array.isArray(body.hitBreakpointIds)
        ? body.hitBreakpointIds.filter((id) => Number.isInteger(id))
        : undefined,
      // A server run judges every pause by the window as it stood when it arrived; a Bun pause also by the learner's breakpoints then (Bun runs during arming). A script run's stops are judged by its own lifecycle, so no arrival evidence is kept for it.
      ...(this.input.stopsJudgedByArrivalWindow
        ? this.windowAtArrival(session.id)
        : {}),
      ...(this.runtime === 'bun'
        ? { learnerBreakpoints: this.learnerBreakpointsNow() }
        : {}),
    }
    // The first stop after an accepted learner `pause` request is the learner's, whatever its reason; its run-on reopens the request window.
    if (this.settleAcceptedLearnerPause(session.id))
      this.learnerPauseStops.set(stop.token, stop)
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
   * Reads the request window and its sign-in phase at the moment a stop arrives.
   * Why it exists: the classification finishes after the stack read, when the sign-in may be over and the window closed; the run judges the stop by what stood at arrival. Called by {@link onStopped} for every stop of a run that judges by the arrival window.
   * @param sessionId - The session that stopped.
   * @returns Whether the window was open, and whether it belonged to the sign-in request (only a window that is open can).
   * @example this.windowAtArrival('session-1') // => { inRequestWindowAtStop: true, inSignInAtStop: true } while the sign-in request is out
   */
  private windowAtArrival(
    sessionId: string,
  ): Pick<NativeStop, 'inRequestWindowAtStop' | 'inSignInAtStop'> {
    const inRequestWindowAtStop = codebookStopLedger.isWindowOpen(sessionId)
    return {
      inRequestWindowAtStop,
      inSignInAtStop: inRequestWindowAtStop && this.requestWindowIsSignIn,
    }
  }

  /**
   * Reads the learner's enabled source breakpoints that are none of the run's own, at the moment a Bun stop arrives.
   * Why it exists: the classification finishes after the stack read, and the editor's breakpoint list may not be read then (a learner's breakpoint that caused the pause can be removed during the wait). Called by {@link onStopped} for a Bun run.
   * @returns The place of each enabled breakpoint of the learner.
   * @example this.learnerBreakpointsNow() // => [{ file: '/repo/src/a.ts', line: 14 }]
   */
  private learnerBreakpointsNow(): LearnerBreakpointPlace[] {
    const ownedIds = new Set(
      this.armed.map(({ breakpoint }) => breakpoint.breakpoint.id),
    )
    return vscode.debug.breakpoints.flatMap((candidate) =>
      candidate instanceof vscode.SourceBreakpoint &&
      candidate.enabled &&
      !ownedIds.has(candidate.id)
        ? [
            {
              file: resolve(candidate.location.uri.fsPath),
              line: candidate.location.range.start.line + 1,
            },
          ]
        : [],
    )
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
    if (ranOn)
      this.resumeThreads(sessionId, ranOn.threadId, ranOn.newestStopToken)
  }

  /**
   * Handles the adapter's answer to the editor's `pause` request: an accepted pause waits for the stop it causes; a refused one (the thread was already paused) caused no stop, so only that request ends and the window it closed may open again.
   * Called by {@link onAdapterMessage} for every response.
   * @param sessionId - The session the response came from.
   * @param response - The adapter's response.
   * @example this.onLearnerPauseAnswered('s1', { type: 'response', seq: 9, request_seq: 7, command: 'pause', success: false }) // ends request 7 of 's1' and reopens its window when nothing else of the learner is outstanding
   */
  private onLearnerPauseAnswered(
    sessionId: string,
    response: DebugProtocol.Response,
  ): void {
    const key = `${sessionId}:${response.request_seq}`
    const pauseRequest = this.learnerPauseRequests.get(key)
    if (!pauseRequest) return
    if (response.success) {
      pauseRequest.accepted = true
      return
    }
    this.learnerPauseRequests.delete(key)
    this.reopenRequestWindow(sessionId)
  }

  /**
   * Ends the oldest accepted learner `pause` request of a session, because the stop that just arrived is the first one after its acceptance.
   * Called by {@link onStopped} for every stop. A request the adapter has not answered yet is not settled: fail closed, the window stays closed until an accepted request meets its stop.
   * @param sessionId - The session that stopped.
   * @returns `true` when the stop is a learner's pause stop; `false` when no accepted Pause request of the session was waiting.
   * @example this.settleAcceptedLearnerPause('s1') // => true after an accepted Pause, then false for the next stop
   */
  private settleAcceptedLearnerPause(sessionId: string): boolean {
    for (const [key, pauseRequest] of this.learnerPauseRequests)
      if (pauseRequest.sessionId === sessionId && pauseRequest.accepted) {
        this.learnerPauseRequests.delete(key)
        return true
      }
    return false
  }

  /**
   * Tells whether the learner still holds something of the session: an unanswered or unsettled `pause` request, or a pause stop that has not run on.
   * Called by {@link reopenRequestWindow}.
   * @param sessionId - The session to ask about.
   * @returns `true` while any learner-pause record of the session remains.
   * @example this.learnerHoldsPause('s1') // => true while a Pause of 's1' awaits its answer or its stop
   */
  private learnerHoldsPause(sessionId: string): boolean {
    for (const pauseRequest of this.learnerPauseRequests.values())
      if (pauseRequest.sessionId === sessionId) return true
    for (const stop of this.learnerPauseStops.values())
      if (stop.sessionId === sessionId) return true
    return false
  }

  /**
   * Opens the request window of the bound session again after a learner's pause ended, only when the run still means it open and the learner holds no other pause of the session: a window the run closed stays closed, and so does one while another Pause is unanswered, unsettled or held.
   * Called by {@link onLearnerPauseAnswered} and {@link endLearnerPausesThatRanOn}.
   * @param sessionId - The session whose window a learner's pause closed.
   * @example this.reopenRequestWindow(this.bound.session.id) // the next declared hit of the same request is attributed again
   */
  private reopenRequestWindow(sessionId: string): void {
    if (
      this.requestWindowIntendedOpen &&
      sessionId === this.bound?.session.id &&
      !this.boundSessionEnded() &&
      !this.learnerHoldsPause(sessionId)
    )
      codebookStopLedger.openWindow([sessionId])
  }

  /**
   * Records that paused threads ran on (Codebook's resume, the learner's Continue or a step, the adapter's own continue) and reports each reported pause among them to the run.
   * @param sessionId - The session whose threads ran on.
   * @param threadId - The one thread that ran on; `undefined` for every thread of the session.
   * @param newestStopToken - The newest stop the resume applies to: a reply to a Continue or step request resumes only the stops that existed when the request was sent, so a stop that arrived before the reply stays a pause; omitted, every stop of the threads ran on.
   * @example this.resumeThreads('session-1', 2, 5) // thread 2's stops up to token 5 ran on; its stop 6 is still paused
   */
  private resumeThreads(
    sessionId: string,
    threadId?: number,
    newestStopToken = Number.POSITIVE_INFINITY,
  ): void {
    const ranOn = (stop: NativeStop): boolean =>
      stop.sessionId === sessionId &&
      (threadId === undefined || stop.threadId === threadId) &&
      stop.token <= newestStopToken
    this.releasePausedThreads(sessionId, threadId, newestStopToken)
    // A stop that ran on is no pause any more: the release, which hands the session's earlier stops to the run, must not report it (a Bun target runs before its release).
    // Only a Bun run drops them here: a node run's release still finds the entry pause the learner continued first.
    if (this.runtime === 'bun')
      for (let index = this.sessionStops.length - 1; index >= 0; index -= 1)
        if (ranOn(this.sessionStops[index]!)) this.sessionStops.splice(index, 1)
    for (const [token, stop] of this.unreportedStops)
      if (ranOn(stop)) this.unreportedStops.delete(token)
    for (const [token, { stop }] of this.livePauses)
      if (ranOn(stop)) {
        this.livePauses.delete(token)
        this.handlers?.onResume(token)
      }
    this.endLearnerPausesThatRanOn(ranOn)
  }

  /**
   * Marks the threads a resume let run on as running, except a thread that stopped again after the resume's newest stop.
   * Called by {@link resumeThreads} before it drops the stops themselves.
   * @param sessionId - The session whose threads ran on.
   * @param threadId - The one thread that ran on; `undefined` for every thread of the session.
   * @param newestStopToken - The newest stop the resume applies to.
   * @example this.releasePausedThreads('session-1', undefined, 5) // every thread of 'session-1' runs, but one whose newest stop is 6 stays paused
   */
  private releasePausedThreads(
    sessionId: string,
    threadId: number | undefined,
    newestStopToken: number,
  ): void {
    const threads = this.pausedThreads.get(sessionId)
    if (!threads) return
    for (const [paused, newestToken] of [...threads])
      // A thread with a later stop (it arrived before the answer) is paused again, whatever the answer says.
      if (
        (threadId === undefined || paused === threadId) &&
        newestToken <= newestStopToken
      )
        threads.delete(paused)
  }

  /**
   * Ends the learner's pauses among the stops that ran on: the request under way is Codebook's again, so its window opens.
   * Called by {@link resumeThreads} after every resume.
   * @param ranOn - Whether a stop's thread ran on.
   * @example this.endLearnerPausesThatRanOn((stop) => stop.sessionId === 's1') // reopens the window of 's1' when its learner pause was among them
   */
  private endLearnerPausesThatRanOn(
    ranOn: (stop: NativeStop) => boolean,
  ): void {
    for (const [token, stop] of this.learnerPauseStops)
      if (ranOn(stop)) {
        this.learnerPauseStops.delete(token)
        this.reopenRequestWindow(stop.sessionId)
      }
  }

  /**
   * Tells whether a pause is the newest stop of its thread and the thread has not run on since: the only pause a Codebook resume may name.
   * Why it exists: a thread's id alone cannot say which pause the caller means, and a resume sent for an older pause acts on the stop that replaced it (the learner's Continue of pause A and exception B that arrived before its answer).
   * @param pause - The pause the caller read.
   * @returns `true` when the pause's token is the newest stop of its still-paused thread.
   * @example this.isNewestPausedStop(pause) // => false after the same thread stopped again as a later stop
   */
  private isNewestPausedStop(pause: NodeServerDebuggerPause): boolean {
    return (
      this.pausedThreads.get(pause.sessionId)?.get(pause.threadId) ===
      pause.token
    )
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
    // An ended session holds no learner pause: its requests and held stops are dropped.
    for (const [key, pauseRequest] of this.learnerPauseRequests)
      if (pauseRequest.sessionId === session.id)
        this.learnerPauseRequests.delete(key)
    for (const [token, stop] of this.learnerPauseStops)
      if (stop.sessionId === session.id) this.learnerPauseStops.delete(token)
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
      // A Bun arming that passed its deadline answers every stop it did not reach as unbound, so the run names the first one.
      if (this.runtime === 'bun' && isArmingDeadline(signal.reason))
        armedStops.push({
          declaredStopIndex: target.declaredStopIndex,
          boundLine: breakpoint.boundPlace(session)?.line,
        })
      else
        armedStops.push(
          await this.armOneStop(target, breakpoint, session, signal),
        )
    }
    return armedStops
  }

  /**
   * Waits for one armed stop's acknowledgement and reads the line it is bound to.
   * Called by {@link armStops} for each stop in order.
   * @param target - The declared stop.
   * @param breakpoint - Its owned breakpoint.
   * @param session - The bound session.
   * @param signal - The arming's cancellation and deadline.
   * @returns The stop's arming answer; a Bun stop the deadline caught before its acknowledgement is answered unbound.
   * @throws The refusal of a stop bound elsewhere, or the abort reason when the run itself ended the arming.
   * @example await this.armOneStop(target, breakpoint, session, signal) // => { declaredStopIndex: 0, breakpointId: 4, boundLine: 14 }
   */
  private async armOneStop(
    target: NodeServerStopTarget,
    breakpoint: OwnedRepositoryBreakpoint,
    session: vscode.DebugSession,
    signal: AbortSignal,
  ): Promise<NodeServerArmedStop> {
    let receipt
    try {
      receipt = await this.registeredAsDeclared(
        breakpoint,
        target,
        session,
        signal,
      )
    } catch (error) {
      // A Bun stop the deadline caught before its acknowledgement is unbound; the run names it.
      if (this.runtime !== 'bun' || !isArmingDeadline(error)) throw error
      return { declaredStopIndex: target.declaredStopIndex }
    }
    // A pending reply names no place yet, so the adapter is asked once more while the server is still paused.
    if (receipt.status === 'pending') {
      try {
        // A Bun arming runs under one shared deadline (the signal's), so the lookup has no shorter bound of its own.
        await breakpoint.assertBoundAsDeclared(
          session,
          signal,
          this.runtime === 'bun' ? NODE_TEST_ATTACH_TIMEOUT_MS : undefined,
        )
      } catch (error) {
        // The shared deadline caught the lookup: the stop is unbound like every stop the deadline reaches; any other end belongs to the run.
        if (
          this.runtime !== 'bun' ||
          !(isArmingDeadline(error) || isArmingDeadline(signal.reason))
        )
          throw error
        return { declaredStopIndex: target.declaredStopIndex }
      }
    }
    return {
      declaredStopIndex: target.declaredStopIndex,
      breakpointId: receipt.breakpointId,
      boundLine: await this.boundLineOf(breakpoint, session, signal),
    }
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
      if (isArmingDeadline(error)) return undefined
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
        (stop.inRequestWindowAtStop ??
          codebookStopLedger.isWindowOpen(session.id)),
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
      // The window and its sign-in phase as they stood when the stop arrived, the same state the ledger verdict above used; none for a run that does not judge by the arrival window.
      ...(stop.inRequestWindowAtStop === undefined
        ? {}
        : {
            inRequestWindowAtStop: stop.inRequestWindowAtStop,
            inSignInAtStop: stop.inSignInAtStop,
          }),
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
      return frame ? this.armedStopAtFrame(session, frame, stop) : undefined
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
   * @param stop - The adapter's stop, which carries the learner's breakpoints as they stood when it arrived.
   * @returns The declared stop index when exactly one armed stop matches; `undefined` for none or several.
   * @example this.armedStopAtFrame(session, { line: 14, column: 24, source: { path: file } }, stop) // => 1 for stops at 14:3 and 14:24
   */
  private armedStopAtFrame(
    session: vscode.DebugSession,
    frame: DebugProtocol.StackFrame,
    stop: NativeStop,
  ): number | undefined {
    // An enabled breakpoint of the learner on the pause's line could have caused it, so the pause is not told apart: it stays the learner's (fail closed). The list is the one copied when the stop arrived, never the editor's list now.
    if (
      frame.source?.path &&
      this.learnerHeldBreakpointAt(stop, frame.source.path, frame.line)
    )
      return undefined
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

  /**
   * Tells whether the learner held an enabled breakpoint that is none of this run's own on a file and line when the stop arrived.
   * Why it exists: an ID-less Bun pause on a line could be the learner's own breakpoint; the copy taken at arrival is the evidence that tells them apart, and it stays whole when the learner removes the breakpoint while the stack is read. A disabled breakpoint cannot pause, and the run's own breakpoints (every declared stop's, not only the one being matched) are not the learner's. Called by {@link armedStopAtFrame}.
   * @param stop - The stop being classified.
   * @param file - The pause's file.
   * @param line - The one-based line of the pause.
   * @returns `true` when an enabled source breakpoint of the learner lay on that file and line at arrival.
   * @example this.learnerHeldBreakpointAt(stop, '/repo/src/a.ts', 14) // => true when the learner's breakpoint on line 14 was enabled as the stop arrived
   */
  private learnerHeldBreakpointAt(
    stop: NativeStop,
    file: string,
    line: number,
  ): boolean {
    return (stop.learnerBreakpoints ?? []).some(
      (place) => place.file === resolve(file) && place.line === line,
    )
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

  setRequestWindow(open: boolean, options?: { signIn: boolean }): void {
    this.requestWindowIntendedOpen = open
    this.requestWindowIsSignIn = open && options?.signIn === true
    const sessionId = this.bound?.session.id
    if (!sessionId) return
    // The run's intent to send never establishes ownership of a stop the learner asked for: while the learner holds a Pause of the session the window stays closed, and it opens when the last learner pause ends ({@link reopenRequestWindow}). A session that ended or is being released never gets a window again.
    if (open && !this.boundSessionEnded() && !this.learnerHoldsPause(sessionId))
      codebookStopLedger.openWindow([sessionId])
    else codebookStopLedger.closeWindow([sessionId])
  }

  /**
   * Tells whether the bound debug session is over for the run: the editor terminated it, or the run began releasing it.
   * Why it exists: the editor ends a session before the run learns whether the server exited (it waits up to 500 ms for that), and a request written in between would run with no debugger watching. The run reads it right before it writes a request; it turns true in the turn the editor reports the termination. Called by the run through {@link NodeServerDebugger.boundSessionEnded}.
   * @returns `true` once the bound session left the editor's active sessions or the release began; `false` before the attach.
   * @example debug.boundSessionEnded() // => true in the turn after the editor's onDidTerminateDebugSession for the bound session
   */
  boundSessionEnded(): boolean {
    const sessionId = this.bound?.session.id
    return (
      sessionId !== undefined &&
      (this.releaseBegun || !this.active.has(sessionId))
    )
  }

  /**
   * Tells whether the learner holds a pause of the bound session: a `pause` request that is unanswered or accepted without its stop, or a learner pause stop that has not run on.
   * Why it exists: the run reads it right before it writes a request, because a request written now would run while the learner asked for the server to stop. Called by the run through {@link NodeServerDebugger.learnerPausePending}.
   * @returns `true` while any learner-pause record of the bound session remains; `false` before the attach.
   * @example debug.learnerPausePending() // => true between the editor's Pause request and the Continue of its stop
   */
  learnerPausePending(): boolean {
    const sessionId = this.bound?.session.id
    return sessionId !== undefined && this.learnerHoldsPause(sessionId)
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
    const inspected = await inspectNodeTestVariables(
      session,
      scopes.scopes,
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
      // A Bun stop saves no automatic copy of its scopes: the declared inspections above are what the replay keeps.
      ...(this.runtime === 'bun' ? { savesNoScopeValues: true as const } : {}),
      limits: {
        timeoutMs: NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
        maxFrames: NODE_REPLAY_DEBUG_MAX_FRAMES,
        maxVariables: NODE_REPLAY_DEBUG_MAX_VARIABLES,
        maxDepth: NODE_REPLAY_DEBUG_MAX_DEPTH,
      },
    })
    assertCurrent()
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
    // A pause that is not its thread's newest stop was replaced by a later one: a continue now would act on that stop, which the caller never read.
    if (!session || !this.isNewestPausedStop(pause))
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
