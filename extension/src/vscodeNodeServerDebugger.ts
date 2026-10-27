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
import { RESUME_COMMANDS } from './runtimeSupport/constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { sha256 } from './runtimeSupport/utils/sha256'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments'
import { bindOwnedNodeTestDebugSession } from './utils/bindOwnedNodeTestDebugSession'
import { boundElsewhereRefusalText } from './utils/boundElsewhereRefusalText'
import { captureReplayDebugSnapshot } from './utils/captureReplayDebugSnapshot'
import { inspectNodeTestVariables } from './utils/inspectNodeTestVariables'
import { isDebugSessionOfRun } from './utils/isDebugSessionOfRun'
import { sourceImportBindings } from './utils/sourceImportBindings'

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
  private readonly pausedSessions = new Set<string>()
  private readonly sessionStops: NativeStop[] = []
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
  private nextToken = 0
  private classification: Promise<void> = Promise.resolve()
  private releaseBegun = false
  private releasing?: Promise<void>
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
    if (RESUME_COMMANDS.has(request.command)) this.resumeSession(session.id)
  }

  /** A message the adapter sends: replies and news for the breakpoints, a `continued` and a `stopped`. */
  private onAdapterMessage(
    session: vscode.DebugSession,
    message: DebugProtocol.ProtocolMessage,
  ): void {
    if (message.type === 'response')
      for (const { breakpoint } of this.armed)
        breakpoint.onResponse(session, message as DebugProtocol.Response)
    if (message.type !== 'event') return
    const event = message as DebugProtocol.Event
    if (event.event === 'breakpoint')
      for (const { breakpoint } of this.armed)
        breakpoint.onEvent(session, event)
    if (event.event === 'continued') this.resumeSession(session.id)
    if (event.event === 'stopped')
      this.onStopped(session, (event as DebugProtocol.StoppedEvent).body)
  }

  /** The adapter reports a stop: it is remembered, and reported to the run once the entry pause is released. */
  private onStopped(
    session: vscode.DebugSession,
    body: DebugProtocol.StoppedEvent['body'],
  ): void {
    if (!Number.isInteger(body.threadId)) return
    this.pausedSessions.add(session.id)
    const stop: NativeStop = {
      token: ++this.nextToken,
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
    if (this.entryReleased) this.enqueueClassification(stop)
  }

  /** Reports to the run that the session's reported pauses ran on (Codebook's resume, the learner's Continue or a step). */
  private resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId)
    for (const [token, { stop }] of this.livePauses)
      if (stop.sessionId === sessionId) {
        this.livePauses.delete(token)
        this.handlers?.onResume(token)
      }
  }

  private onSessionTerminated(session: vscode.DebugSession): void {
    this.pausedSessions.delete(session.id)
    codebookStopLedger.forget(session.id)
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
  }): Promise<void> {
    const { workspace, runId } = this.input
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
        boundLine: breakpoint.verifiedPlace(session)?.line,
      })
    }
    return armedStops
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

  async releaseEntry(signal: AbortSignal): Promise<void> {
    const session = this.boundSession()
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

  /** Reads one stop's stack and reports it to the run, in arrival order. */
  private enqueueClassification(stop: NativeStop): void {
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
    // Only the bound session's pauses are the run's; a child session's stop is not reported.
    if (!session || this.releaseBegun || session.id !== this.bound?.session.id)
      return
    const trace = await this.readStack(session, stop)
    // A thread that ran on while its stack was read is no pause any more.
    if (!this.pausedSessions.has(stop.sessionId)) return
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
    if (stop.reason !== 'breakpoint' || !stop.hitBreakpointIds) return undefined
    for (const { target, breakpoint } of this.armed) {
      const id = breakpoint.acknowledgedId(session)
      if (id === undefined || !stop.hitBreakpointIds.includes(id)) continue
      const line = breakpoint.verifiedPlace(session)?.line ?? target.line
      if (!frame || (frame.source?.path === target.file && frame.line === line))
        return target.declaredStopIndex
    }
    return undefined
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
    if (!session || !this.pausedSessions.has(pause.sessionId))
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
    const attempt = (this.releasing ??= this.releaseOwned())
    return attempt.catch((error: unknown) => {
      // A failed release is dropped, so the next stop runs it again.
      if (this.releasing === attempt) this.releasing = undefined
      throw error
    })
  }

  /** Removes the breakpoints, ends the sessions this run started and stops listening; run again after a failure, so each step can repeat. */
  private async releaseOwned(): Promise<void> {
    this.releaseBegun = true
    this.abort.abort()
    this.bound?.cdp.close()
    for (const { breakpoint } of this.armed) breakpoint.remove()
    const sessions = [...this.active.values()]
    const results = await Promise.allSettled(
      sessions.map((session) => vscode.debug.stopDebugging(session)),
    )
    for (const session of sessions) codebookStopLedger.forget(session.id)
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
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
