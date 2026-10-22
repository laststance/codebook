import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'

import type { ConfiguredDescriptor } from './configuredStudySchemas'
import {
  NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  NODE_REPLAY_DEBUG_MAX_DEPTH,
  NODE_REPLAY_DEBUG_MAX_FRAMES,
  NODE_REPLAY_DEBUG_MAX_VARIABLES,
  NODE_TEST_ATTACH_TIMEOUT_MS,
  NODE_TEST_EXIT_GRACE_MS,
} from './constants'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
import { NodeTestOutputTerminal } from './nodeTestOutputTerminal'
import {
  OwnedBreakpointMovedError,
  OwnedRepositoryBreakpoint,
} from './ownedRepositoryBreakpoint'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import type { NodeTestRuntime } from './runtime'
import { codebookStopLedger } from './runtimeSupport/codebookStopLedger'
import { RESUME_COMMANDS } from './runtimeSupport/constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { sha256 } from './runtimeSupport/utils/sha256'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { assertConfiguredSourceDocuments } from './utils/assertConfiguredSourceDocuments'
import { bindOwnedNodeTestDebugSession } from './utils/bindOwnedNodeTestDebugSession'
import { boundElsewhereRefusalText } from './utils/boundElsewhereRefusalText'
import { captureReplayDebugSnapshot } from './utils/captureReplayDebugSnapshot'
import {
  inspectNodeTestVariables,
  type NodeTestFact,
} from './utils/inspectNodeTestVariables'
import { launchNodeTest } from './utils/launchNodeTest'
import { listVitestTestFiles } from './utils/listVitestTestFiles'
import { prepareNodeTestLaunch } from './utils/prepareNodeTestLaunch'
import type { PreparedNodeTestLaunch } from './utils/prepareNodeTestLaunch'
import { selectCheckedNodeFrame } from './utils/selectCheckedNodeFrame'
import { thrownMessage } from './utils/thrownMessage'
import { verifyVitestTestResult } from './utils/verifyVitestTestResult'

/** One DAP `stopped` event observed on an owned session, in arrival order; `hitBreakpointIds` names the breakpoints the adapter says caused it. */
type NativePause = {
  sessionId: string
  threadId: number
  reason: string
  afterClientResume: boolean
  hitBreakpointIds?: number[]
}

export type NodeTestSourceStop = {
  index: number
  runId: string
  sessionId: string
  threadId: number
  elapsedMs: number
  worker: Awaited<ReturnType<typeof bindOwnedNodeTestDebugSession>>['identity']
  source: NodeTestConfiguration['source']
  frame: DebugProtocol.StackFrame
  variables: DebugProtocol.Variable[]
  facts: NodeTestFact[]
  debuggerSnapshot: ReplayDebugSnapshot
}

/** Owns a checked repository Vitest process and ordered native source pauses until explicit release. Called by the Node profile runtime after citation checks. @example const run = new OwnedNodeTestRun(workspace, config, node, record, descriptor.sources); await run.prepare(); while (run.hasNextStop()) await run.advance(); await run.complete(); await run.stop() */
export class OwnedNodeTestRun {
  readonly id = randomUUID()
  private readonly abort = new AbortController()
  private readonly active = new Map<string, vscode.DebugSession>()
  private readonly stops: NativePause[] = []
  private readonly pausedSessions = new Set<string>()
  /** Sessions whose client sent a resume or step request after their latest `stopped` event. */
  private readonly clientResumes = new Set<string>()
  private readonly name = `codebook node test ${this.id}`
  private readonly tracker: vscode.Disposable
  private readonly termination: vscode.Disposable
  private owned?: Awaited<ReturnType<typeof launchNodeTest>>
  private breakpoint?: OwnedRepositoryBreakpoint
  private outputTerminal?: NodeTestOutputTerminal
  private bound?: Awaited<ReturnType<typeof bindOwnedNodeTestDebugSession>>
  private preparation?: Promise<NodeTestSourceStop>
  /** The release under way ({@link release}); a failed one is dropped, so the next call runs it again. */
  private cleanup?: Promise<void>
  /** Set by the first {@link release}: from then on {@link advance} and {@link complete} refuse, also while a failed release waits to be run again. */
  private releaseBegun = false
  private acceptedStop?: NodeTestSourceStop
  /** The native pause event behind {@link acceptedStop}; a client resume or a different later pause revokes its continuation authority, while a same-frame stack refresh inherits it. */
  private acceptedPause?: NativePause
  private launch?: PreparedNodeTestLaunch
  /** The final continuation while it waits for the process and reads Vitest's report; the release removes the report only once it settled (EN5). */
  private completing?: Promise<unknown>
  /** The adapter's id for the breakpoint of the stop being awaited, from its registration receipt. */
  private ownedBreakpointId?: number
  private advancing = false

  constructor(
    private readonly workspace: string,
    private readonly configuration: NodeTestConfiguration,
    private readonly node: string,
    private readonly record: (type: string, detail?: unknown) => unknown,
    /** The article's text of every source the selected node cites; {@link prepareOwned} refuses the run, and {@link advance} and {@link captureStop} end it at a continuation or at a stop, while the editor holds other text for one of them. A trial without an article gives none. */
    private readonly citedSources: ConfiguredDescriptor['sources'],
  ) {
    this.tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker: (session) => {
        if (!this.owner(session)) return
        this.active.set(session.id, session)
        // Every stop of an owned Node test session belongs to the run, so the keyboard stays where Codebook left it.
        codebookStopLedger.ownSession(session.id)
        this.record('node-test.session-started', {
          sessionId: session.id,
          parentId: session.parentSession?.id,
        })
        return {
          onWillReceiveMessage: (message): void => {
            if (message.type !== 'request') return
            const request = message as DebugProtocol.Request
            this.breakpoint?.onRequest(session, request)
            // Adapters need not send `continued` after a client resume or step, so the request itself revokes the captured pause.
            if (RESUME_COMMANDS.has(request.command)) {
              this.pausedSessions.delete(session.id)
              this.clientResumes.add(session.id)
            }
          },
          onDidSendMessage: (message): void => {
            if (message.type === 'response')
              this.breakpoint?.onResponse(
                session,
                message as DebugProtocol.Response,
              )
            // The adapter's later news about the owned breakpoint (a pending one it verifies) is read before the editor drops its column.
            this.forwardBreakpointNews(session, message)
            if (
              message.type === 'event' &&
              (message as DebugProtocol.Event).event === 'continued'
            )
              this.pausedSessions.delete(session.id)
            if (
              message.type === 'event' &&
              (message as DebugProtocol.Event).event === 'stopped'
            ) {
              const body = (message as DebugProtocol.StoppedEvent).body
              if (Number.isInteger(body.threadId)) {
                this.pausedSessions.add(session.id)
                const hitBreakpointIds = Array.isArray(body.hitBreakpointIds)
                  ? body.hitBreakpointIds.filter((id) => Number.isInteger(id))
                  : undefined
                this.stops.push({
                  sessionId: session.id,
                  threadId: body.threadId!,
                  reason: body.reason,
                  afterClientResume: this.clientResumes.delete(session.id),
                  hitBreakpointIds,
                })
                this.record('node-test.dap-stopped', {
                  sessionId: session.id,
                  threadId: body.threadId,
                  reason: body.reason,
                })
              }
            }
          },
          onError: (error) =>
            this.record('node-test.debugger-error', { message: error.message }),
        }
      },
    })
    this.termination = vscode.debug.onDidTerminateDebugSession((session) => {
      this.pausedSessions.delete(session.id)
      this.clientResumes.delete(session.id)
      codebookStopLedger.forget(session.id)
      if (this.active.delete(session.id))
        this.record('node-test.session-terminated', { sessionId: session.id })
    })
  }

  /** Acquires the exact checked test and waits for its native source breakpoint and variable scope. @example const sourceStop = await run.prepare() */
  prepare(): Promise<NodeTestSourceStop> {
    if (this.preparation) return this.preparation
    this.preparation = this.prepareOwned().catch(async (error: unknown) => {
      const failure = await this.explainEarlyExit(error)
      await this.release()
      throw failure
    })
    return this.preparation
  }

  /**
   * Checks, launches and attaches the cited test up to its first declared stop; the work behind {@link prepare}, which releases everything when this rejects.
   * @returns The first declared stop, captured at its native pause.
   * @throws A `SOURCE_CHANGED` {@link StudyError} before Vitest is asked anything while the editor holds other text for a cited source than the article cites; otherwise the failure of the check, the launch, the attach or the wait that failed.
   * @example
   * ```ts
   * this.preparation = this.prepareOwned() // => the stop at theme.ts:1:14 with its variables and facts
   * ```
   */
  private async prepareOwned(): Promise<NodeTestSourceStop> {
    // The debugger is started without saving, so the editor would show unsaved lines at a pause while the test executes the saved file: refused first, before the listing, the terminal, the test and the debugger.
    assertConfiguredSourceDocuments(
      this.workspace,
      this.citedSources,
      vscode.workspace.textDocuments,
    )
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
    ])
    const launch = (this.launch = await prepareNodeTestLaunch(
      this.workspace,
      this.configuration,
      (request) =>
        listVitestTestFiles({
          ...request,
          node: this.node,
          signal,
          // A failed release is journaled with its group and folder. A listing that failed keeps its own reason; a listing that finished but whose process group could not be confirmed as ended refuses the run, so the test is not started.
          onReleaseFailed: (failure) => {
            this.record('node-test.vitest-listing-not-released', failure)
          },
        }),
    ))
    signal.throwIfAborted()
    this.outputTerminal = new NodeTestOutputTerminal(this.id, vscode, () => {
      this.record('node-test.output-surface-closed')
      this.abort.abort(
        new Error('Owned Node test output surface closed during capture.'),
      )
    })
    await this.outputTerminal.ready(signal)
    this.record('node-test.output-surface-ready', {
      terminal: this.outputTerminal.terminal.name,
    })
    this.owned = await launchNodeTest(
      launch,
      this.node,
      this.record,
      (event) => {
        this.outputTerminal!.write(event)
        return Promise.resolve(this.record('node-test.output', event)).then(
          () => undefined,
        )
      },
    )
    const endpoint = await this.owned.inspectorEndpoint(signal)
    signal.throwIfAborted()
    // The debugger may bind the declared line at another column; the stop is then captured there (F155). A registration acknowledged on another line fails here, before the test continues.
    this.breakpoint = new OwnedRepositoryBreakpoint(
      launch.stops[0]!.file,
      launch.stops[0]!.source.line,
      launch.stops[0]!.source.column,
      'declared-line',
    )
    const started = await vscode.debug.startDebugging(
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(launch.workspace)),
      {
        name: this.name,
        type: 'pwa-node',
        request: 'attach',
        websocketAddress: endpoint,
        cwd: launch.workspace,
        restart: false,
        autoAttachChildProcesses: false,
        continueOnAttach: false,
        sourceMaps: true,
        timeout: NODE_TEST_ATTACH_TIMEOUT_MS,
      },
      // Without this the editor saves every modified editor of the learner as the session starts; a learner's document is saved by the learner alone.
      { suppressSaveBeforeStart: true },
    )
    signal.throwIfAborted()
    if (!started)
      throw new Error('Native Node debugger refused the owned attach.')
    this.bound = await waitUntil(
      async () => {
        for (const session of this.active.values()) {
          try {
            return await bindOwnedNodeTestDebugSession(
              session,
              this.id,
              launch.workspace,
              this.owned!.processGroup!,
              signal,
              (sessionId) => this.assertActive(sessionId),
            )
          } catch (error) {
            if (signal.aborted) throw error
          }
        }
        return undefined
      },
      'owned native Node test debugger',
      NODE_TEST_ATTACH_TIMEOUT_MS,
      signal,
    )
    this.record('node-test.worker-verified', {
      sessionId: this.bound.session.id,
      identity: this.bound.identity,
    })
    const registration = await this.registeredAsDeclared(
      launch.stops[0]!.source,
      signal,
    )
    this.ownedBreakpointId = registration.breakpointId
    this.record('node-test.breakpoint-ack', {
      status: registration.status,
      elapsedMs: this.owned.elapsedMs(),
    })
    const entry = await waitUntil(
      () =>
        this.stops.find((stop) => stop.sessionId === this.bound!.session.id),
      'Node entry stop',
      NODE_TEST_ATTACH_TIMEOUT_MS,
      signal,
    )
    const fromIndex = this.stops.length
    // An adapter that never answers would hold the preparation, which a stop waits for; every request below takes the run's cancellation for the same reason.
    await awaitResponse(
      this.bound.session.customRequest('continue', {
        threadId: entry.threadId,
      }),
      'the entry continuation',
      this.abort.signal,
    )
    this.record('node-test.entry-continued', {
      elapsedMs: this.owned.elapsedMs(),
    })
    return this.captureStop(0, fromIndex)
  }

  /**
   * Hands the adapter's `breakpoint` events to the owned breakpoint, for the tracker of the owned session: a pending breakpoint the adapter verifies later names its place only there, and the tracker reads it with its column, which both editors drop for a breakpoint requested at column 1.
   * @param session - The owned session that sent the message.
   * @param message - Any message of the adapter; only a `breakpoint` event is forwarded.
   * @example
   * ```ts
   * this.forwardBreakpointNews(session, { type: 'event', event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 4, verified: true, line: 20, column: 12 } } })
   * ```
   */
  private forwardBreakpointNews(
    session: vscode.DebugSession,
    message: DebugProtocol.ProtocolMessage,
  ): void {
    if (message.type !== 'event') return
    const event = message as DebugProtocol.Event
    if (event.event === 'breakpoint') this.breakpoint?.onEvent(session, event)
  }

  /**
   * Waits for the adapter's acknowledgement of the current stop's owned breakpoint, for {@link prepareOwned} and {@link advance}; news that put the breakpoint away from the declared position before the receipt was read is refused with the sentence of every such binding.
   * @param declared - The position the stop was declared at.
   * @param signal - The caller's cancellation and budget.
   * @returns The adapter's receipt, `pending` or `bound`.
   * @throws The refusal of {@link boundElsewhereRefusalText} when the adapter's news names another place; every other failure of the registration unchanged.
   * @example
   * ```ts
   * const registered = await this.registeredAsDeclared(next.source, signal) // { status: 'pending', breakpointId: 4, ... }
   * ```
   */
  private async registeredAsDeclared(
    declared: { line: number; column: number },
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<OwnedRepositoryBreakpoint['registered']>>> {
    try {
      return await this.breakpoint!.registered(this.bound!.session, signal)
    } catch (error) {
      if (!(error instanceof OwnedBreakpointMovedError)) throw error
      throw new Error(boundElsewhereRefusalText(declared, error.place))
    }
  }

  /**
   * Refuses a stop whose owned breakpoint the adapter's news put away from the declared position, at the moment that news arrives; {@link advance} asks it before it resumes the test and {@link captureStop} at every look while the test runs, so the stop does not end one resume later or at its budget.
   * @param declared - The position the stop was declared at.
   * @throws The refusal of {@link boundElsewhereRefusalText}, naming both positions.
   * @example
   * ```ts
   * this.assertNotMovedByNews(next.source) // throws 'Declared breakpoint 20:1 is bound at 22:5; …' once the adapter reported 22:5
   * ```
   */
  private assertNotMovedByNews(declared: {
    line: number
    column: number
  }): void {
    const place = this.breakpoint?.refusedPlace(this.bound!.session)
    if (place) throw new Error(boundElsewhereRefusalText(declared, place))
  }

  /**
   * Classifies the paused stack against the declared stop, at the column the debugger bound the owned breakpoint at on the declared line; called by {@link captureStop} once for each pause.
   * The debugger may bind a breakpoint requested at one column to another column of the same line, and the stop is then captured there (F155). The bound column is the verified place of the owned breakpoint, or, while its registration is still pending and names no place, the column of a pause that the owned breakpoint itself hit on the declared line. A pause on another line, and a learner's breakpoint on the declared line, keep the declared column.
   * @param frames - The paused thread's frames, top first.
   * @param selected - The declared stop: its file and position.
   * @param pause - The stopped event being examined.
   * @returns The classification of {@link selectCheckedNodeFrame}, matched at the bound column when the owned breakpoint is bound there.
   * @example
   * this.checkFrameAtBoundColumn(frames, selected, pause).status // 'matched' for a stop declared at 16:5 and bound at 16:29
   */
  private checkFrameAtBoundColumn(
    frames: DebugProtocol.StackFrame[],
    selected: { file: string; source: { line: number; column: number } },
    pause: { reason: string; hitBreakpointIds?: number[] },
  ): ReturnType<typeof selectCheckedNodeFrame> {
    const { line, column } = selected.source
    const verified = this.breakpoint?.verifiedPlace(this.bound!.session)
    const check = (atColumn: number) =>
      selectCheckedNodeFrame(
        frames,
        selected.file,
        line,
        atColumn,
        pause.reason,
      )
    // The declared column first: a pause there is the declared stop whoever set the breakpoint that paused (F220).
    const atDeclared = check(column)
    if (
      atDeclared.status !== 'wrong-position' ||
      atDeclared.observedFrame.line !== line
    )
      return atDeclared
    const observedColumn = atDeclared.observedFrame.column
    const isOwnedHit =
      this.ownedBreakpointId !== undefined &&
      pause.hitBreakpointIds?.includes(this.ownedBreakpointId) === true
    const isLearnerHit = pause.hitBreakpointIds !== undefined && !isOwnedHit
    const boundColumn = verified?.line === line ? verified.column : undefined
    // The owned breakpoint's bound column: the pause is there and is not a learner's own breakpoint.
    if (!isLearnerHit && boundColumn === observedColumn)
      return check(boundColumn)
    // A registration that names no place yet: the pause the owned breakpoint itself hit shows where it is bound.
    if (isOwnedHit && boundColumn === undefined) return check(observedColumn)
    return atDeclared
  }

  /** Reports whether another declared checked source stop must be captured before the test may finish. @example while (run.hasNextStop()) await run.advance() */
  hasNextStop(): boolean {
    return Boolean(
      this.acceptedStop &&
      this.launch &&
      this.acceptedStop.index + 1 < this.launch.stops.length,
    )
  }

  /**
   * Retires the last owned breakpoint, arms the next declared stop, resumes the test and captures the stop's actual paused state; called by the service for a continuation that has a next declared stop.
   * @returns The next declared stop, captured at its native pause.
   * @throws When no next stop can be captured, the accepted pause changed, the next breakpoint is not bound as declared or the capture fails; a `SOURCE_CHANGED` {@link StudyError}, without a resume, while the editor holds other text for a cited source than the article cites. Every failure releases the run.
   * @example
   * ```ts
   * const next = await run.advance() // => { index: 1, frame: { line: 1, column: 14, ... }, ... }
   * ```
   */
  async advance(): Promise<NodeTestSourceStop> {
    const previous = this.acceptedStop,
      bound = this.bound,
      launch = this.launch,
      breakpoint = this.breakpoint
    if (
      !previous ||
      !bound ||
      !launch ||
      !breakpoint ||
      !this.hasNextStop() ||
      this.advancing ||
      this.releaseBegun
    )
      throw new Error('Node test has no next declared source stop to capture.')
    this.advancing = true
    try {
      const signal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
      ])
      await this.assertAcceptedPause(previous, 'the next declared stop')
      await breakpoint.retire(bound.session, signal)
      const next = launch.stops[previous.index + 1]!
      this.breakpoint = new OwnedRepositoryBreakpoint(
        next.file,
        next.source.line,
        next.source.column,
        'declared-line',
      )
      const registered = await this.registeredAsDeclared(next.source, signal)
      this.ownedBreakpointId = registered.breakpointId
      // A pending reply names no position, so the adapter is asked once more while the test is still paused.
      if (registered.status === 'pending')
        await this.breakpoint.assertBoundAsDeclared(bound.session, signal)
      // News that arrived since the receipt was read is refused while the test is still paused.
      this.assertNotMovedByNews(next.source)
      // The learner can resume or step while retirement and registration are awaited.
      await this.assertAcceptedPause(previous, 'the next declared stop')
      // Nor is the test resumed on a cited source the learner changed in the editor without saving: the next pause would mark a line of that text. Compared last, so nothing is awaited between this and the resume.
      assertConfiguredSourceDocuments(
        this.workspace,
        this.citedSources,
        vscode.workspace.textDocuments,
      )
      const fromIndex = this.stops.length
      await awaitResponse(
        bound.session.customRequest('continue', {
          threadId: previous.threadId,
        }),
        'the continuation to the next declared stop',
        this.abort.signal,
      )
      return await this.captureStop(previous.index + 1, fromIndex)
    } catch (error) {
      await this.release()
      throw error
    } finally {
      this.advancing = false
    }
  }

  /**
   * Waits for the declared stop, then captures its values, stack and verified source for the history.
   *
   * A pause Codebook did not make, such as the learner's own breakpoint, is never resumed here. It is reported once as `node-test.learner-paused`,
   * and the time the test spends held there does not count against the stop budget. Called by {@link prepareOwned} and {@link advance}.
   *
   * @param index - Declared stop to capture.
   * @param fromIndex - First native pause that can belong to this stop.
   * @returns The accepted stop.
   * @throws When the session ends, the owned breakpoint pauses elsewhere in the declared source, the running test exceeds the budget, or capture fails; a `SOURCE_CHANGED` {@link StudyError} when the editor holds other text for a cited source than the article cites at the pause.
   * @example
   * ```ts
   * await this.captureStop(0, this.stops.length) // => { index: 0, frame: { line: 217, column: 21, ... }, facts: [...], ... }
   * ```
   */
  private async captureStop(
    index: number,
    fromIndex: number,
  ): Promise<NodeTestSourceStop> {
    const launch = this.launch!,
      bound = this.bound!,
      selected = launch.stops[index]!
    const examined = new Map<
      NativePause,
      {
        checkedFrame: ReturnType<typeof selectCheckedNodeFrame>
        trace: DebugProtocol.StackTraceResponse['body']
      }
    >()
    let runningMs = 0,
      lastPollMs = performance.now(),
      held = false
    const target = await waitUntil(
      async () => {
        // A test process that ended can never reach this stop; fail now instead of at the budget.
        this.assertActive(bound.session.id)
        // Neither can a stop whose breakpoint the adapter's news put away from the declared position.
        this.assertNotMovedByNews(selected.source)
        const nowMs = performance.now()
        // Only time the test could run counts; while a pause Codebook did not make holds it, the learner decides when it continues.
        if (!held) runningMs += nowMs - lastPollMs
        lastPollMs = nowMs
        held = false
        const latest = this.stops
          .slice(fromIndex)
          .filter((candidate) => candidate.sessionId === bound.session.id)
          .at(-1)
        if (latest && this.pausedSessions.has(bound.session.id)) {
          let examination = examined.get(latest)
          // Each pause is inspected once, while it is current; an earlier pause's thread may already be running.
          if (!examination) {
            const trace = (await awaitResponse(
              bound.session.customRequest('stackTrace', {
                threadId: latest.threadId,
                startFrame: 0,
                levels: NODE_REPLAY_DEBUG_MAX_FRAMES,
              }),
              'the paused stack',
              this.abort.signal,
            )) as DebugProtocol.StackTraceResponse['body']
            const checkedFrame = this.checkFrameAtBoundColumn(
              trace.stackFrames,
              selected,
              latest,
            )
            examination = { checkedFrame, trace }
            examined.set(latest, examination)
            this.record('node-test.frame-checked', {
              index,
              requestedLine: selected.source.line,
              requestedColumn: selected.source.column,
              observedLine: checkedFrame.observedFrame?.line ?? null,
              observedColumn: checkedFrame.observedFrame?.column ?? null,
              sameSource: Boolean(checkedFrame.observedFrame),
              exact: checkedFrame.status === 'matched',
              elapsedMs: this.owned?.elapsedMs() ?? 0,
            })
            if (checkedFrame.status === 'matched')
              return { stop: latest, frame: checkedFrame.frame, trace }
            // The learner's own breakpoint may sit anywhere, even in the declared source; only the owned breakpoint pausing elsewhere means the stop moved.
            const learnerBreakpoint =
              latest.reason === 'breakpoint' &&
              this.ownedBreakpointId !== undefined &&
              latest.hitBreakpointIds !== undefined &&
              !latest.hitBreakpointIds.includes(this.ownedBreakpointId)
            if (
              checkedFrame.status === 'wrong-position' &&
              !learnerBreakpoint
            ) {
              throw new Error(
                `Native Node debugger stopped at ${checkedFrame.observedFrame.line}:${checkedFrame.observedFrame.column} instead of declared ${selected.source.line}:${selected.source.column}.`,
              )
            }
            const pausedFrame = trace.stackFrames[0],
              pausedPath = pausedFrame?.source?.path
            const repositoryPath =
              pausedPath === undefined
                ? undefined
                : relative(launch.workspace, pausedPath)
            // Events leave the editor, so a location outside the repository is named by its file name only.
            this.record('node-test.learner-paused', {
              index,
              path:
                pausedPath === undefined
                  ? null
                  : repositoryPath &&
                      !repositoryPath.startsWith('..') &&
                      !isAbsolute(repositoryPath)
                    ? repositoryPath
                    : basename(pausedPath),
              line: pausedFrame?.line ?? null,
              column: pausedFrame?.column ?? null,
              reason: latest.reason,
            })
          }
          if (examination.checkedFrame.status === 'matched')
            return {
              stop: latest,
              frame: examination.checkedFrame.frame,
              trace: examination.trace,
            }
          held = true
          return undefined
        }
        if (runningMs > NODE_TEST_ATTACH_TIMEOUT_MS)
          throw new Error('Timed out waiting for checked Node source stop')
        return undefined
      },
      'checked Node source stop',
      Number.POSITIVE_INFINITY,
      this.abort.signal,
    )
    // Capturing gets its own budget once the stop is reached, however long the learner held the test before it.
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
    ])
    this.assertActive(bound.session.id)
    const scopes = (await awaitResponse(
      bound.session.customRequest('scopes', {
        frameId: target.frame.id,
      }),
      "the stop's scopes",
      signal,
    )) as DebugProtocol.ScopesResponse['body']
    const local =
      scopes.scopes.find((scope) =>
        scope.name.toLowerCase().includes('local'),
      ) ?? scopes.scopes[0]
    if (!local)
      throw new Error(
        'Native debugger supplied no variable scope at the source stop.',
      )
    const result = await inspectNodeTestVariables(
      bound.session,
      scopes.scopes,
      selected.inspections,
      signal,
    )
    signal.throwIfAborted()
    this.assertActive(bound.session.id)
    const assertCurrent = (): void => {
      this.assertActive(bound.session.id)
      if (
        !this.pausedSessions.has(bound.session.id) ||
        this.stops
          .filter((stop) => stop.sessionId === bound.session.id)
          .at(-1) !== target.stop
      )
        throw new Error(
          'Owned Node source pause changed during historical debugger capture.',
        )
    }
    assertCurrent()
    const sourceBytes = await readFile(selected.file)
    assertCurrent()
    if (sha256(sourceBytes) !== selected.source.hash)
      throw new Error(
        'Node test source changed during historical debugger capture.',
      )
    // The file is the cited one; a document the learner changed without saving since the start would still make the editor's debugger mark another line than the test executes at this pause.
    assertConfiguredSourceDocuments(
      this.workspace,
      this.citedSources,
      vscode.workspace.textDocuments,
    )
    this.record('node-test.snapshot-started', {
      index,
      elapsedMs: this.owned?.elapsedMs() ?? 0,
    })
    const debuggerSnapshot = await captureReplayDebugSnapshot({
      stack: target.trace,
      verifiedSource: {
        name: selected.source.path,
        text: sourceBytes.toString('utf8'),
        hash: selected.source.hash,
        line: target.frame.line,
      },
      request: (command, arguments_) =>
        bound.session.customRequest(command, arguments_),
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
    this.acceptedPause = target.stop
    const stop = (this.acceptedStop = {
      index,
      runId: this.id,
      sessionId: bound.session.id,
      threadId: target.stop.threadId,
      elapsedMs: this.owned?.elapsedMs() ?? 0,
      worker: bound.identity,
      source: selected.source,
      frame: target.frame,
      variables: result.variables,
      facts: result.facts,
      debuggerSnapshot,
    })
    this.record('node-test.source-stopped', {
      index,
      sessionId: stop.sessionId,
      threadId: stop.threadId,
      path: stop.source.path,
      line: stop.frame.line,
      column: stop.frame.column,
      variableNames: stop.variables.map((value) => value.name),
    })
    this.revealOutput()
    return stop
  }

  /**
   * Restores this run's output tab after the native debugger opened its console, unless the run was aborted: a stop began its release, which disposes the tab, or the learner closed the tab, which aborts the run. The stop or result just observed stands without the reveal (EN5); called by {@link captureStop} and {@link completeOwned}.
   * @example this.revealOutput()
   */
  private revealOutput(): void {
    if (!this.abort.signal.aborted) this.outputTerminal?.reveal()
  }

  /**
   * Continues only the accepted paused session and waits for the real test command outcome; the last continuation {@link StudyService.continue} makes.
   * The process's exit facts are kept when Vitest's report cannot confirm the cited test (EN5): a non-zero exit or a signal already says the test did not pass, so it is returned with the report's problem beside it; an exit 0 rejects, so nothing claims a pass the report did not confirm.
   * @returns The exit code or signal, the bounded output, the elapsed time, and `reportFailure` for a failing exit whose report could not confirm the cited test.
   * @throws When there is no final accepted pause, the pause was resumed, the run was cancelled (also while the adapter has not answered the continue, which is otherwise bounded by {@link ACTIVE_TIMEOUT_MS}), or an exit 0 has no report that shows the cited test passed.
   * @example const result = await run.complete() // => { exitCode: 0, signal: null, output: '…', elapsedMs: 3120 }
   */
  complete(): ReturnType<NodeTestRuntime['complete']> {
    const completing = this.completeOwned()
    this.completing = completing.catch(() => undefined)
    return completing
  }

  /**
   * Does the work of {@link complete}, which keeps it while it runs so a release waits for it before it removes the report.
   * @returns What {@link complete} returns.
   * @example await this.completeOwned()
   */
  private async completeOwned(): ReturnType<NodeTestRuntime['complete']> {
    const stop = this.acceptedStop,
      bound = this.bound,
      owned = this.owned,
      launch = this.launch
    if (
      !stop ||
      !bound ||
      !owned ||
      !launch ||
      this.releaseBegun ||
      this.advancing ||
      this.hasNextStop()
    )
      throw new Error('Node test has no final owned source pause to continue.')
    this.abort.signal.throwIfAborted()
    await this.assertAcceptedPause(stop, 'the final continuation')
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
    ])
    // A declared line inside a loop or shared helper would otherwise pause the finishing test with nobody to resume it.
    await this.breakpoint?.retire(bound.session, signal)
    // A stale continuation would otherwise resume whichever later pause the learner reached during retirement.
    await this.assertAcceptedPause(stop, 'the final continuation')
    // A release waits for this continuation before it removes the report, so an unanswered continue must not outlive the run's cancellation.
    await awaitResponse(
      bound.session.customRequest('continue', { threadId: stop.threadId }),
      'the final continuation',
      this.abort.signal,
    )
    // The attach timeout bounds only the retirement above; the remaining tests may run until cancellation or the run deadline.
    const result = await owned.result(this.abort.signal)
    const elapsedMs = owned.elapsedMs()
    // A stop and an exit code cannot show which test ran: module loading can reach the stop while Vitest skips the cited test.
    const report = await verifyVitestTestResult(
      launch.report.file,
      launch.testFile,
      launch.testTitles,
    ).then(
      (status) => ({ status, failure: undefined }),
      (error: unknown) => ({
        status: undefined,
        failure: thrownMessage(error),
      }),
    )
    const exitPassed = result.exitCode === 0 && result.signal === null
    // An exit 0 passes only with a report that shows the cited test passed; nothing else confirms it.
    if (exitPassed && report.failure !== undefined)
      throw new Error(report.failure)
    // A plugin can reset process.exitCode after failed assertions; a successful exit cannot override the report.
    if (exitPassed && report.status === 'failed')
      throw new Error(
        'Vitest reported that the cited test failed despite process exit code 0; the run cannot be marked successful.',
      )
    this.record('node-test.result', {
      exitCode: result.exitCode,
      signal: result.signal,
      elapsedMs,
      output: result.output,
    })
    this.revealOutput()
    // A failing exit is a fact of its own; the report's problem goes beside it.
    return report.failure === undefined
      ? { ...result, elapsedMs }
      : { ...result, elapsedMs, reportFailure: report.failure }
  }

  /** Cancels the run and releases only its tracked native sessions, breakpoint and process group. @example await run.stop() */
  async stop(): Promise<void> {
    this.abort.abort()
    await this.preparation?.catch(() => undefined)
    await this.release()
  }

  /**
   * Names the likely cause when the owned test process ended before its first declared stop, most often because Vitest skipped the cited test.
   *
   * Called by {@link prepare} when preparation fails. Cancellation and failures after a captured stop keep their original error.
   *
   * @param error - The preparation failure.
   * @returns The original error, or one that states the exit code and points to `testTitles`.
   * @example
   * ```ts
   * await this.explainEarlyExit(new Error('Owned Node debugger session terminated or was cancelled.'))
   * // => Error('Owned Node test exited with code 0 before declared stop 1. ...')
   * ```
   */
  private async explainEarlyExit(error: unknown): Promise<unknown> {
    if (this.abort.signal.aborted || this.acceptedStop || !this.owned)
      return error
    // A still-attached session means the process is alive, so this failure has another cause.
    if (this.bound && this.active.has(this.bound.session.id)) return error
    const exit = await this.owned.waitForExit(NODE_TEST_EXIT_GRACE_MS)
    if (!exit) return error
    return new Error(
      `Owned Node test exited with ${exit.signal ? `signal ${exit.signal}` : `code ${exit.exitCode}`} before declared stop 1. ` +
        'Its output is in the Codebook test output. If Vitest skipped the cited test, check that testTitles names it exactly; see codebook://help/node-test.',
      { cause: error },
    )
  }

  private owner(session: vscode.DebugSession): boolean {
    for (
      let ancestor: vscode.DebugSession | undefined = session;
      ancestor;
      ancestor = ancestor.parentSession
    )
      if (ancestor.configuration.name === this.name) return true
    return false
  }

  private assertActive(sessionId: string): void {
    if (this.abort.signal.aborted || !this.active.has(sessionId))
      throw new Error(
        'Owned Node debugger session terminated or was cancelled.',
      )
  }

  /**
   * Refuses a Codebook continuation once the learner resumed, stepped or reached a later pause after {@link acceptedStop} was captured.
   * {@link advance} and {@link complete} call it before and after breakpoint retirement, so a stale continue never resumes an unaccepted pause.
   * js-debug re-announces an unchanged pause (`continued`, then `stopped`) when it refreshes the stack, for example after Toggle Skipping this File;
   * such a pause is adopted only when no client resume preceded it and the paused top frame is still the accepted position.
   * @param stop - The accepted stop being continued.
   * @param purpose - What the continuation was for, named in the refusal.
   * @throws When the session ended, the pause was resumed, or a different pause replaced it.
   * @example
   * ```ts
   * await this.assertAcceptedPause(stop, 'the final continuation') // throws after a manual Continue in the native debugger
   * ```
   */
  private async assertAcceptedPause(
    stop: NodeTestSourceStop,
    purpose: string,
  ): Promise<void> {
    this.assertActive(stop.sessionId)
    const refusal = new Error(
      `Owned Node source pause was resumed before ${purpose}.`,
    )
    const sessionPauses = () =>
      this.stops.filter((candidate) => candidate.sessionId === stop.sessionId)
    const pauses = sessionPauses(),
      accepted = this.acceptedPause
        ? pauses.lastIndexOf(this.acceptedPause)
        : -1
    if (!this.pausedSessions.has(stop.sessionId) || accepted < 0) throw refusal
    const laterPauses = pauses.slice(accepted + 1),
      latestPause = laterPauses.at(-1)
    if (!latestPause) return
    // A client resume or step always precedes a genuinely different pause; a stack refresh has none.
    if (
      laterPauses.some(
        (pause) => pause.afterClientResume || pause.threadId !== stop.threadId,
      )
    )
      throw refusal
    const trace = (await awaitResponse(
      this.bound!.session.customRequest('stackTrace', {
        threadId: stop.threadId,
        startFrame: 0,
        levels: 1,
      }),
      'the paused frame',
      this.abort.signal,
    )) as DebugProtocol.StackTraceResponse['body']
    const pausedFrame = trace.stackFrames[0]
    this.assertActive(stop.sessionId)
    // Anything else that resumed the thread, such as another inspector client, leaves a different frame or a newer event.
    const unchanged =
      pausedFrame?.source?.path === stop.frame.source?.path &&
      pausedFrame?.line === stop.frame.line &&
      pausedFrame?.column === stop.frame.column
    if (
      !unchanged ||
      !this.pausedSessions.has(stop.sessionId) ||
      sessionPauses().at(-1) !== latestPause
    )
      throw refusal
    this.record('node-test.pause-refreshed', {
      sessionId: stop.sessionId,
      threadId: stop.threadId,
      line: stop.frame.line,
      column: stop.frame.column,
    })
    this.acceptedPause = latestPause
  }

  /**
   * Releases everything the run owns, one release at a time; called by {@link stop}, and by {@link prepare} and {@link advance} when they fail.
   * A release under way is shared by every caller. One that failed is not kept: the next call runs it again, as the owned process's own close does, so that the service's next stop can release the run once the cause is gone; a kept rejection would leave the run unreleased for good, and every `codebook_start` would answer BUSY until a reload.
   * @throws What {@link releaseOwned} throws; the next call tries again.
   * @example await this.release()
   */
  private async release(): Promise<void> {
    this.releaseBegun = true
    const attempt = (this.cleanup ??= this.releaseOwned())
    try {
      await attempt
    } catch (error) {
      // Only this failed attempt is dropped; a newer one that a later call started stays shared.
      if (this.cleanup === attempt) this.cleanup = undefined
      throw error
    }
  }

  /**
   * Stops the run's debug sessions and releases its CDP connection, breakpoint, output terminal, test process group and private report folder; the body of {@link release}, run again after a failure, so each step is one that can be repeated.
   * A run again stops no session that has ended, and stops one that started after the failure: the run hears of ended and of new sessions until a release has succeeded, and an ended one leaves `active`, a new one joins it. VS Code (1.120 to 1.142) stops an ended session that its debug model still lists without a refusal, but refuses one it no longer lists with "debug session not found", and it drops an ended session, and only an ended one, when a newer session of its name starts: a retry that stopped such a session again would fail for good, and every `codebook_start` would answer BUSY until a reload.
   * @throws The first debug session stop that failed, else the failure of the process release or of the report folder's removal.
   * @example await this.releaseOwned()
   */
  private async releaseOwned(): Promise<void> {
    this.abort.abort()
    this.bound?.cdp.close()
    this.breakpoint?.remove()
    this.outputTerminal?.dispose()
    const results = await Promise.allSettled(
      [...this.active.values()].map((session) =>
        vscode.debug.stopDebugging(session),
      ),
    )
    let processFailure: unknown
    try {
      await this.owned?.close()
    } catch (error) {
      processFailure = error
    }
    // The private Vitest report is evidence only until the result check; nothing else reads it. A check under way finishes reading first (EN5).
    await this.completing
    if (this.launch)
      await rm(this.launch.report.directory, {
        recursive: true,
        force: true,
      }).catch((error: unknown) => {
        processFailure ??= error
      })
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (processFailure) throw processFailure
    // Only a release that succeeded stops hearing of sessions: until then a session that ends leaves `active`, and one that starts joins it (a test process that outlived a failed release can start a child session), so a retry stops what is running and no more.
    this.tracker.dispose()
    this.termination.dispose()
  }
}
