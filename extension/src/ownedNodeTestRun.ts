import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'

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
import { OwnedRepositoryBreakpoint } from './ownedRepositoryBreakpoint'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import { RESUME_COMMANDS } from './runtimeSupport/constants'
import { sha256 } from './runtimeSupport/utils/sha256'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { bindOwnedNodeTestDebugSession } from './utils/bindOwnedNodeTestDebugSession'
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

/** Owns a checked repository Vitest process and ordered native source pauses until explicit release. Called by the Node profile runtime after citation checks. @example const run = new OwnedNodeTestRun(workspace, config, node, record); await run.prepare(); while (run.hasNextStop()) await run.advance(); await run.complete(); await run.stop() */
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
  private cleanup?: Promise<void>
  private acceptedStop?: NodeTestSourceStop
  /** The native pause event behind {@link acceptedStop}; a client resume or a different later pause revokes its continuation authority, while a same-frame stack refresh inherits it. */
  private acceptedPause?: NativePause
  private launch?: PreparedNodeTestLaunch
  /** The adapter's id for the breakpoint of the stop being awaited, from its registration receipt. */
  private ownedBreakpointId?: number
  private advancing = false

  constructor(
    private readonly workspace: string,
    private readonly configuration: NodeTestConfiguration,
    private readonly node: string,
    private readonly record: (type: string, detail?: unknown) => unknown,
  ) {
    this.tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker: (session) => {
        if (!this.owner(session)) return
        this.active.set(session.id, session)
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

  private async prepareOwned(): Promise<NodeTestSourceStop> {
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(NODE_TEST_ATTACH_TIMEOUT_MS),
    ])
    const launch = (this.launch = await prepareNodeTestLaunch(
      this.workspace,
      this.configuration,
      (request) => listVitestTestFiles({ ...request, node: this.node, signal }),
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
    this.breakpoint = new OwnedRepositoryBreakpoint(
      launch.stops[0]!.file,
      launch.stops[0]!.source.line,
      launch.stops[0]!.source.column,
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
    const registration = await this.breakpoint.registered(
      this.bound.session,
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
    await this.bound.session.customRequest('continue', {
      threadId: entry.threadId,
    })
    this.record('node-test.entry-continued', {
      elapsedMs: this.owned.elapsedMs(),
    })
    return this.captureStop(0, fromIndex)
  }

  /** Reports whether another declared checked source stop must be captured before the test may finish. @example while (run.hasNextStop()) await run.advance() */
  hasNextStop(): boolean {
    return Boolean(
      this.acceptedStop &&
      this.launch &&
      this.acceptedStop.index + 1 < this.launch.stops.length,
    )
  }

  /** Retires the last owned breakpoint, arms the next declared stop and captures its actual paused state. @example const next = await run.advance() */
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
      this.cleanup
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
      )
      this.ownedBreakpointId = (
        await this.breakpoint.registered(bound.session, signal)
      ).breakpointId
      // The learner can resume or step while retirement and registration are awaited.
      await this.assertAcceptedPause(previous, 'the next declared stop')
      const fromIndex = this.stops.length
      await bound.session.customRequest('continue', {
        threadId: previous.threadId,
      })
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
   * @throws When the session ends, the owned breakpoint pauses elsewhere in the declared source, the running test exceeds the budget, or capture fails.
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
            const trace = (await bound.session.customRequest('stackTrace', {
              threadId: latest.threadId,
              startFrame: 0,
              levels: NODE_REPLAY_DEBUG_MAX_FRAMES,
            })) as DebugProtocol.StackTraceResponse['body']
            const checkedFrame = selectCheckedNodeFrame(
              trace.stackFrames,
              selected.file,
              selected.source.line,
              selected.source.column,
              latest.reason,
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
    const scopes = (await bound.session.customRequest('scopes', {
      frameId: target.frame.id,
    })) as DebugProtocol.ScopesResponse['body']
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
    this.outputTerminal?.reveal()
    return stop
  }

  /** Continues only the accepted paused session and waits for the real test command outcome. @example const result = await run.complete() */
  async complete(): Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
    output: string
    elapsedMs: number
  }> {
    const stop = this.acceptedStop,
      bound = this.bound,
      owned = this.owned,
      launch = this.launch
    if (
      !stop ||
      !bound ||
      !owned ||
      !launch ||
      this.cleanup ||
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
    await bound.session.customRequest('continue', { threadId: stop.threadId })
    // The attach timeout bounds only the retirement above; the remaining tests may run until cancellation or the run deadline.
    const result = await owned.result(this.abort.signal)
    // A stop and an exit code cannot show which test ran: module loading can reach the stop while Vitest skips the cited test.
    const reportedStatus = await verifyVitestTestResult(
      launch.report.file,
      launch.testFile,
      launch.testTitles,
    )
    // A plugin can reset process.exitCode after failed assertions; a successful exit cannot override the report.
    if (
      reportedStatus === 'failed' &&
      result.exitCode === 0 &&
      result.signal === null
    )
      throw new Error(
        'Vitest reported that the cited test failed despite process exit code 0; the run cannot be marked successful.',
      )
    const elapsedMs = owned.elapsedMs()
    this.record('node-test.result', {
      exitCode: result.exitCode,
      signal: result.signal,
      elapsedMs,
      output: result.output,
    })
    this.outputTerminal?.reveal()
    return { ...result, elapsedMs }
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
    const trace = (await this.bound!.session.customRequest('stackTrace', {
      threadId: stop.threadId,
      startFrame: 0,
      levels: 1,
    })) as DebugProtocol.StackTraceResponse['body']
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

  private release(): Promise<void> {
    this.cleanup ??= (async () => {
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
      } finally {
        this.tracker.dispose()
        this.termination.dispose()
      }
      // The private Vitest report is evidence only until the result check; nothing else reads it.
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
    })()
    return this.cleanup
  }
}
