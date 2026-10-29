import { readFile } from 'node:fs/promises'

import type { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'
import { z } from 'zod'

import type {
  CapturedExtensionStop,
  ExtensionStopContext,
} from './chromeExtensionContracts'
import type {
  ChromeExtensionDebugger,
  ExtensionActionGuard,
  ExtensionContinueArguments,
  ExtensionDebuggerHandlers,
  ExtensionDebuggerInput,
  ExtensionIntervention,
  ExtensionPauseView,
} from './chromeExtensionDebugger'
import { ExtensionOutputJournal } from './chromeExtensionOutputJournal'
import {
  ExtensionPauseSet,
  viewOfPause,
  type ExtensionPause,
} from './chromeExtensionPauseSet'
import {
  ExtensionStopRegistry,
  type ExtensionHitVerdict,
  type LogicalExtensionStop,
} from './chromeExtensionStopRegistry'
import {
  CHROME_EXTENSION_SESSION_NAME_PREFIX,
  EXTENSION_OPEN_BOUND_MS,
  EXTENSION_WAKE_BOUND_MS,
  EXTENSION_WORKER_PAUSE_HOLD_MS,
  MILLISECONDS_PER_SECOND,
  NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  NODE_REPLAY_DEBUG_MAX_DEPTH,
  NODE_REPLAY_DEBUG_MAX_FRAMES,
  NODE_REPLAY_DEBUG_MAX_VARIABLES,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import { codebookStopLedger } from './runtimeSupport/codebookStopLedger'
import { RESUME_COMMANDS } from './runtimeSupport/constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { sha256 } from './runtimeSupport/utils/sha256'
import { WaitTimeoutError } from './runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { captureReplayDebugSnapshot } from './utils/captureReplayDebugSnapshot'
import { isDebugSessionOfRun } from './utils/isDebugSessionOfRun'

type StackBody = DebugProtocol.StackTraceResponse['body']

/** The adapter's later news about one of its breakpoints: its id and whether it is verified in the session. */
const breakpointNewsSchema = z.object({
  breakpoint: z.object({ id: z.number().int(), verified: z.boolean() }),
})

/** What a run-owned session turned out to be: the attach itself, the surface's page, the extension's worker, or a target the run ignores (other tabs, other extensions' workers). */
type SessionKind = 'pending' | 'root' | 'page' | 'worker' | 'other'

type SessionEntry = {
  session: vscode.DebugSession
  kind: SessionKind
  classified: Promise<void>
  /** The target URL of an adopted worker, recorded in each capture. */
  targetUrl?: string
}

/** The worker watch of one running action. */
type ActionWatch = { restarted: boolean }

const CONTEXT_OF_KIND: Record<'page' | 'worker', ExtensionStopContext> = {
  page: 'page',
  worker: 'service-worker',
}

/**
 * The editor's side of a chrome-extension run: one js-debug `pwa-chrome` attach to Codebook's own browser, the run's child sessions told apart by target type, the declared stops as physical breakpoints with logical stops per context, and the pause set.
 * Created by {@link createVscodeChromeExtensionDebugger} when the run is made; it follows the tracker and pause bookkeeping of {@link VscodeNodeServerDebugger} but keeps a pause set instead of one pause (ER16) and several sessions (page and worker).
 */
class VscodeChromeExtensionDebugger implements ChromeExtensionDebugger {
  private readonly name: string
  private readonly abort = new AbortController()
  private readonly entries = new Map<string, SessionEntry>()
  private readonly registry: ExtensionStopRegistry
  private readonly pauseSet = new ExtensionPauseSet()
  private readonly output: ExtensionOutputJournal
  private readonly holdTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly pendingResumes = new Map<
    string,
    { command: string; threadId?: number; singleThread: boolean }
  >()
  private readonly actionWatches = new Set<ActionWatch>()
  private readonly interventionList: ExtensionIntervention[] = []
  private handlers?: ExtensionDebuggerHandlers
  private generation = 0
  private readonly unverifiedWorkerStops = new Set<number>()
  private ready = false
  private releaseBegun = false
  private releasing?: Promise<void>
  private readonly tracker: vscode.Disposable
  private readonly termination: vscode.Disposable

  constructor(private readonly input: ExtensionDebuggerInput) {
    this.name = `${CHROME_EXTENSION_SESSION_NAME_PREFIX}${input.runId}`
    this.registry = new ExtensionStopRegistry(input.run.stops)
    this.output = new ExtensionOutputJournal(input.record, input.roots)
    this.tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker: (session) => this.trackerFor(session),
    })
    this.termination = vscode.debug.onDidTerminateDebugSession((session) =>
      this.onSessionTerminated(session),
    )
  }

  get pauseState() {
    return this.pauseSet
  }

  private now(): number {
    return (this.input.now ?? Date.now)()
  }

  private fail(error: StudyError): void {
    this.handlers?.onFailure(error)
  }

  subscribe(handlers: ExtensionDebuggerHandlers): { dispose(): void } {
    this.handlers = handlers
    const stopListening = this.pauseSet.onChange(() => handlers.onChange())
    return {
      dispose: (): void => {
        stopListening()
        if (this.handlers === handlers) this.handlers = undefined
      },
    }
  }

  // ---------------------------------------------------------------- sessions

  /** Offers the tracker for a session of this run; every other session is not the run's. */
  private trackerFor(
    session: vscode.DebugSession,
  ): vscode.DebugAdapterTracker | undefined {
    if (!isDebugSessionOfRun(session, this.name)) return undefined
    const entry: SessionEntry = {
      session,
      kind: 'pending',
      classified: Promise.resolve(),
    }
    entry.classified = this.classify(entry)
    this.entries.set(session.id, entry)
    return {
      onWillReceiveMessage: (message): void =>
        this.onClientMessage(entry, message),
      onDidSendMessage: (message): void =>
        this.onAdapterMessage(entry, message),
      onError: (error) =>
        this.input.record('chrome-extension.debugger-error', {
          message: error.message,
        }),
    }
  }

  /**
   * Decides what a session is from the target the adapter created it for, never from its name (SR14).
   * Sets `entry.kind`; a worker is adopted only when its target URL is under the run's extension id.
   */
  private async classify(entry: SessionEntry): Promise<void> {
    const configuration = entry.session.configuration
    const targetType: unknown = configuration.__browserTargetType
    const targetId: unknown = configuration.__pendingTargetId
    if (configuration.name === this.name) entry.kind = 'root'
    else if (targetType === 'page')
      entry.kind = targetId === this.input.surfaceTargetId ? 'page' : 'other'
    else if (targetType === 'service_worker' && typeof targetId === 'string') {
      const url = await this.input.targetUrlOf(targetId).catch(() => undefined)
      const isOwnWorker = Boolean(
        url?.startsWith(`chrome-extension://${this.input.run.extensionId}/`),
      )
      entry.kind = isOwnWorker ? 'worker' : 'other'
      if (isOwnWorker) {
        entry.targetUrl = url
        this.bumpGeneration()
      }
    } else entry.kind = 'other'
  }

  private entriesOf(kind: 'page' | 'worker'): SessionEntry[] {
    return [...this.entries.values()].filter((entry) => entry.kind === kind)
  }

  private sessionsOf(context: ExtensionStopContext): vscode.DebugSession[] {
    const kind = context === 'page' ? 'page' : 'worker'
    return this.entriesOf(kind).map((entry) => entry.session)
  }

  /** A new worker instance: later captures carry the new generation, and an action in progress fails (ER17). */
  private bumpGeneration(): void {
    this.generation += 1
    // The first worker of the run, seen before any action, is no restart.
    for (const watch of this.actionWatches) watch.restarted = true
    if (this.actionWatches.size > 0)
      this.fail(
        new StudyError(
          'SERVICE_WORKER_RESTARTED',
          "The extension's service worker restarted during a click.",
        ),
      )
  }

  private onSessionTerminated(session: vscode.DebugSession): void {
    const entry = this.entries.get(session.id)
    if (!entry) return
    this.entries.delete(session.id)
    codebookStopLedger.forget(session.id)
    const ended = this.pauseSet.close(session.id)
    for (const pause of ended) this.clearHold(pause)
    // A worker that ends while a pause was open lost the pause and the run's state (ER8).
    if (entry.kind === 'worker' && ended.length > 0 && !this.releaseBegun)
      this.fail(
        new StudyError(
          'SERVICE_WORKER_LOST',
          "The extension's service worker stopped while it was paused.",
        ),
      )
  }

  // ---------------------------------------------------------------- the editor's and adapter's messages

  private onClientMessage(
    entry: SessionEntry,
    message: DebugProtocol.ProtocolMessage,
  ): void {
    if (message.type !== 'request') return
    const request = message as DebugProtocol.Request
    this.registry.onRequest(entry.session, request)
    // Whether the thread runs on is the adapter's answer: a rejected resume leaves it paused.
    if (RESUME_COMMANDS.has(request.command)) {
      const threadId: unknown = request.arguments?.threadId
      this.pendingResumes.set(`${entry.session.id}:${request.seq}`, {
        command: request.command,
        threadId: typeof threadId === 'number' ? threadId : undefined,
        singleThread: request.arguments?.singleThread === true,
      })
    }
  }

  private onAdapterMessage(
    entry: SessionEntry,
    message: DebugProtocol.ProtocolMessage,
  ): void {
    if (message.type === 'response') {
      const response = message as DebugProtocol.Response
      this.registry.onResponse(entry.session, response)
      this.onResumeAnswered(entry.session.id, response)
      return
    }
    if (message.type !== 'event') return
    const event = message as DebugProtocol.Event
    if (event.event === 'breakpoint') this.onBreakpointEvent(entry, event)
    if (event.event === 'continued') {
      const continued = (event as DebugProtocol.ContinuedEvent).body
      this.resumeThreads(
        entry.session.id,
        continued.allThreadsContinued === false
          ? continued.threadId
          : undefined,
      )
    }
    if (event.event === 'stopped')
      void this.onStopped(entry, (event as DebugProtocol.StoppedEvent).body)
    if (event.event === 'output')
      void this.onOutput(entry, (event as DebugProtocol.OutputEvent).body)
  }

  /** Routes a `breakpoint` event; a worker stop that was verified and turns unverified is a restart of the worker (ER17). */
  private onBreakpointEvent(
    entry: SessionEntry,
    event: DebugProtocol.Event,
  ): void {
    this.registry.onEvent(entry.session, event)
    if (entry.kind !== 'worker') return
    const news = breakpointNewsSchema.safeParse(event.body)
    if (!news.success) return
    const logical = this.registry.stopOfBreakpointId(
      entry.session,
      news.data.breakpoint.id,
    )
    if (logical?.stop.context !== 'service-worker') return
    const index = logical.stop.index
    if (
      !news.data.breakpoint.verified &&
      !this.unverifiedWorkerStops.has(index)
    ) {
      // The adapter lost the stop in the worker: the worker restarted, so a new generation begins.
      this.unverifiedWorkerStops.add(index)
      this.bumpGeneration()
    } else if (
      news.data.breakpoint.verified &&
      this.unverifiedWorkerStops.delete(index)
    ) {
      // The adapter set the stop again in the restarted worker.
      this.recordIntervention('re-arm')
    }
  }

  /** Whether every unretired worker stop is verified in a worker session and none was lost to a restart; vacuously true without worker stops or worker. */
  private workerStopsBound(): boolean {
    const sessions = this.sessionsOf('service-worker')
    if (sessions.length === 0) return true
    return this.registry.logical
      .filter(
        (entry) => !entry.retired && entry.stop.context === 'service-worker',
      )
      .every(
        (entry) =>
          this.registry.bindingOf(entry, sessions) === 'bound' &&
          !this.unverifiedWorkerStops.has(entry.stop.index),
      )
  }

  private onResumeAnswered(
    sessionId: string,
    response: DebugProtocol.Response,
  ): void {
    const key = `${sessionId}:${response.request_seq}`
    const pending = this.pendingResumes.get(key)
    if (!pending) return
    this.pendingResumes.delete(key)
    if (!response.success) return
    const everyThread =
      pending.command === 'continue'
        ? response.body?.allThreadsContinued !== false
        : !pending.singleThread
    this.resumeThreads(sessionId, everyThread ? undefined : pending.threadId)
  }

  /** Threads ran on (Codebook's continue, the learner's, the adapter's own): their pauses end and their captures and continue arguments go stale. */
  private resumeThreads(sessionId: string, threadId?: number): void {
    for (const pause of this.pauseSet.close(sessionId, threadId))
      this.clearHold(pause)
  }

  // ---------------------------------------------------------------- stops

  /** The adapter reports a stop: classified by reason, owned breakpoint id and location, then kept or resumed (ER13). */
  private async onStopped(
    entry: SessionEntry,
    body: DebugProtocol.StoppedEvent['body'],
  ): Promise<void> {
    await entry.classified
    if (this.releaseBegun || !Number.isInteger(body.threadId)) return
    if (entry.kind !== 'page' && entry.kind !== 'worker') return
    const context = CONTEXT_OF_KIND[entry.kind]
    const threadId = body.threadId!
    const ids = body.hitBreakpointIds ?? []
    // A learner breakpoint beside the owned one, or any reason but a breakpoint, stays the learner's.
    const verdict =
      body.reason === 'breakpoint' &&
      !this.registry.hasForeignId(entry.session, ids)
        ? this.registry.verdictOf(entry.session, context, ids)
        : undefined
    if (!verdict) return this.keepLearnerPause(entry, threadId, body.reason)
    await this.actOnVerdict(entry, threadId, body.reason, verdict)
  }

  private async actOnVerdict(
    entry: SessionEntry,
    threadId: number,
    reason: string,
    verdict: ExtensionHitVerdict,
  ): Promise<void> {
    const { stop } = verdict.logical
    const context = CONTEXT_OF_KIND[entry.kind as 'page' | 'worker']
    if (verdict.kind === 'repeat') {
      this.input.record('chrome-extension.repeat-hit', {
        stopIndex: stop.index,
        path: stop.path,
        line: stop.line,
      })
      return this.autoResume(entry, threadId)
    }
    if (verdict.kind === 'mismatch') {
      this.input.record('chrome-extension.context-mismatch', {
        stopIndex: stop.index,
        context,
      })
      return this.autoResume(entry, threadId)
    }
    // Before `ready` a declared hit is startup code: resumed at once, never offered to the chat.
    if (!this.ready) {
      this.input.record('chrome-extension.prepare-pause', {
        path: stop.path,
        line: stop.line,
        context,
      })
      this.recordIntervention('resume-prepare-pause')
      return this.autoResume(entry, threadId)
    }
    this.keepDeclaredPause(entry, threadId, reason, verdict.logical)
  }

  private async autoResume(
    entry: SessionEntry,
    threadId: number,
  ): Promise<void> {
    try {
      await awaitResponse(
        entry.session.customRequest('continue', { threadId }),
        'the automatic continuation',
        this.abort.signal,
      )
    } catch (error) {
      this.input.record('chrome-extension.debugger-error', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private keepLearnerPause(
    entry: SessionEntry,
    threadId: number,
    reason: string,
  ): void {
    if (entry.kind !== 'page' && entry.kind !== 'worker') return
    codebookStopLedger.recordStop(entry.session.id, false)
    this.pauseSet.open({
      sessionId: entry.session.id,
      threadId,
      context: CONTEXT_OF_KIND[entry.kind],
      reason,
      kind: 'learner',
      status: 'not-captured',
      pausedAtMs: this.now(),
    })
  }

  private keepDeclaredPause(
    entry: SessionEntry,
    threadId: number,
    reason: string,
    logical: LogicalExtensionStop,
  ): void {
    const context = CONTEXT_OF_KIND[entry.kind as 'page' | 'worker']
    // The stop is taken at its hit, so a second thread reaching it is a repeat.
    this.registry.retire(logical)
    codebookStopLedger.recordStop(entry.session.id, true)
    const pause = this.pauseSet.open({
      sessionId: entry.session.id,
      threadId,
      context,
      reason,
      kind: 'declared',
      stopIndex: logical.stop.index,
      status: 'capturing',
      pausedAtMs: this.now(),
    })
    this.startHold(pause)
    pause.captureDone = this.capture(pause, logical, entry)
  }

  private startHold(pause: ExtensionPause): void {
    const holdMs =
      pause.context === 'service-worker'
        ? EXTENSION_WORKER_PAUSE_HOLD_MS
        : REPOSITORY_PAUSE_HOLD_TIMEOUT_MS
    const timer = setTimeout(
      () =>
        this.fail(
          new StudyError(
            'PAUSE_HOLD_EXPIRED',
            `A stop was held longer than ${holdMs / MILLISECONDS_PER_SECOND} s.`,
          ),
        ),
      holdMs,
    )
    // A held pause alone never keeps the editor process alive.
    timer.unref?.()
    this.holdTimers.set(pause.generation, timer)
  }

  private clearHold(pause: ExtensionPause): void {
    clearTimeout(this.holdTimers.get(pause.generation))
    this.holdTimers.delete(pause.generation)
  }

  private async onOutput(
    entry: SessionEntry,
    body: DebugProtocol.OutputEvent['body'],
  ): Promise<void> {
    await entry.classified
    if (entry.kind !== 'page' && entry.kind !== 'worker') return
    if (body.category === 'telemetry') return
    this.output.add(CONTEXT_OF_KIND[entry.kind], body.output)
  }

  // ---------------------------------------------------------------- capture and continue

  /** Captures a declared pause; a pause that ended meanwhile (the learner's continue) drops the capture silently. */
  private async capture(
    pause: ExtensionPause,
    logical: LogicalExtensionStop,
    entry: SessionEntry,
  ): Promise<void> {
    try {
      pause.captured = await this.readCapture(pause, logical, entry)
      pause.status = 'captured'
    } catch (error) {
      if (!this.pauseSet.isCurrent(pause)) return
      pause.status = 'capture-failed'
      pause.captureFailure =
        error instanceof Error ? error.message : String(error)
      if (error instanceof StudyError) this.fail(error)
    }
    this.pauseSet.notify()
  }

  private async readCapture(
    pause: ExtensionPause,
    logical: LogicalExtensionStop,
    entry: SessionEntry,
  ): Promise<CapturedExtensionStop> {
    const { stop } = logical
    const assertCurrent = (): void => {
      if (this.releaseBegun || !this.pauseSet.isCurrent(pause))
        throw new Error('The extension pause changed during the capture.')
    }
    await this.input.assertSourcesUnchanged()
    assertCurrent()
    const sourceText = await this.readPinnedSource(logical)
    const stack = (await awaitResponse(
      entry.session.customRequest('stackTrace', {
        threadId: pause.threadId,
        startFrame: 0,
        levels: NODE_REPLAY_DEBUG_MAX_FRAMES,
      }),
      'the paused stack',
      this.abort.signal,
    )) as StackBody
    const frame = stack.stackFrames[0]
    if (!frame) throw new Error('The paused stack has no frame.')
    assertCurrent()
    const snapshot = await captureReplayDebugSnapshot({
      stack,
      verifiedSource: {
        name: stop.path,
        text: sourceText,
        hash: stop.sha256,
        line: frame.line,
      },
      request: (command, arguments_) =>
        entry.session.customRequest(command, arguments_),
      assertCurrent,
      signal: this.abort.signal,
      limits: {
        timeoutMs: NODE_REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
        maxFrames: NODE_REPLAY_DEBUG_MAX_FRAMES,
        maxVariables: NODE_REPLAY_DEBUG_MAX_VARIABLES,
        maxDepth: NODE_REPLAY_DEBUG_MAX_DEPTH,
      },
    })
    // The pinned bytes and the editor's documents are checked again after the read.
    await this.readPinnedSource(logical)
    await this.input.assertSourcesUnchanged()
    assertCurrent()
    return {
      stopIndex: stop.index,
      context: pause.context,
      workerGeneration:
        pause.context === 'service-worker' ? this.generation : 0,
      targetUrl:
        pause.context === 'service-worker'
          ? (entry.targetUrl ?? this.input.run.surfaceUrl)
          : this.input.run.surfaceUrl,
      sha256: stop.sha256,
      capturedAtMs: this.now(),
      snapshot,
    }
  }

  /**
   * Reads the stop's file and requires the bytes pinned at `starting` (ER20).
   * @returns The text of the pinned file.
   * @throws A {@link StudyError} `SOURCE_CHANGED` when the file's hash differs.
   */
  private async readPinnedSource(
    logical: LogicalExtensionStop,
  ): Promise<string> {
    const bytes = await readFile(logical.stop.absolutePath)
    if (sha256(bytes) !== logical.stop.sha256)
      throw new StudyError(
        'SOURCE_CHANGED',
        `${logical.stop.path} changed after the run started.`,
      )
    return bytes.toString('utf8')
  }

  pauses(): ExtensionPauseView[] {
    return this.pauseSet.list().map((pause) => viewOfPause(pause))
  }

  async resume(
    args: ExtensionContinueArguments,
    signal: AbortSignal,
  ): Promise<void> {
    const pause = this.pauseSet.find(args)
    if (!pause || pause.resuming)
      throw new StudyError(
        'STALE_PAUSE',
        'The stop is no longer paused or its continue arguments are out of date.',
      )
    if (pause.kind === 'learner')
      throw new StudyError(
        'LEARNER_PAUSED',
        "The learner paused the extension; the learner continues it in the editor's debugger.",
      )
    // Claimed before any await, so a second continue of the same pause is stale.
    pause.resuming = true
    try {
      await pause.captureDone
      await this.input.assertSourcesUnchanged()
      const session = this.entries.get(pause.sessionId)?.session
      if (!session || !this.pauseSet.isCurrent(pause))
        throw new StudyError(
          'STALE_PAUSE',
          'The stop ended before it was continued.',
        )
      await awaitResponse(
        session.customRequest('continue', { threadId: pause.threadId }),
        'the continuation',
        signal,
      )
      this.resumeThreads(pause.sessionId, pause.threadId)
    } catch (error) {
      pause.resuming = false
      throw error
    }
  }

  stopsNotReached(): number[] {
    return this.registry.unretiredIndexes()
  }

  workerGeneration(): number {
    return this.generation
  }

  markReady(): void {
    this.ready = true
  }

  beginAction(): ExtensionActionGuard {
    const watch: ActionWatch = { restarted: false }
    this.actionWatches.add(watch)
    return {
      assertCurrent: (): void => {
        if (watch.restarted)
          throw new StudyError(
            'SERVICE_WORKER_RESTARTED',
            "The extension's service worker restarted during a click.",
          )
      },
      end: (): void => {
        this.actionWatches.delete(watch)
      },
    }
  }

  // ---------------------------------------------------------------- attach, worker, arming

  /** Bounds a wait and words its timeout as the run's refusal. */
  private async waitOr<Value>(
    read: () => Value | Promise<Value>,
    description: string,
    boundMs: number,
    signal: AbortSignal,
    refusal: () => StudyError,
  ): Promise<NonNullable<Value>> {
    try {
      return await waitUntil(read, description, boundMs, signal)
    } catch (error) {
      if (error instanceof WaitTimeoutError) throw refusal()
      throw error
    }
  }

  async attach(signal: AbortSignal): Promise<void> {
    const { run, workspace } = this.input
    const refusal = (): StudyError =>
      new StudyError(
        'SURFACE_NOT_ATTACHED',
        `The debugger could not attach to the extension ${run.surface.kind}.`,
      )
    const started = await vscode.debug.startDebugging(
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace)),
      {
        type: 'pwa-chrome',
        request: 'attach',
        name: this.name,
        port: this.input.port,
        webRoot: run.root,
        urlFilter: run.surfaceUrl,
        pathMapping: {
          [`chrome-extension://${run.extensionId}/`]: `${run.root}/`,
        },
        targetSelection: 'automatic',
      },
      // The editor would save the learner's modified documents as the session starts; a learner's document is saved by the learner alone.
      { suppressSaveBeforeStart: true },
    )
    signal.throwIfAborted()
    if (!started) throw refusal()
    await this.waitOr(
      async () => {
        await Promise.all([...this.entries.values()].map((e) => e.classified))
        return this.entriesOf('page')[0]
      },
      'the extension surface session',
      EXTENSION_OPEN_BOUND_MS,
      signal,
      refusal,
    )
  }

  private workerNotAttached(): StudyError {
    return new StudyError(
      'SERVICE_WORKER_NOT_ATTACHED',
      `The extension's service worker did not start while ${this.input.run.surface.kind} was open.`,
    )
  }

  async waitForWorker(signal: AbortSignal): Promise<void> {
    await this.waitOr(
      async () => {
        await Promise.all([...this.entries.values()].map((e) => e.classified))
        return this.entriesOf('worker')[0]
      },
      'the extension worker session',
      EXTENSION_WAKE_BOUND_MS,
      signal,
      () => this.workerNotAttached(),
    )
  }

  async armStops(signal: AbortSignal): Promise<void> {
    this.registry.arm()
    await this.waitOr(
      () => this.assertAllBound(),
      'the declared stops to be verified',
      EXTENSION_WAKE_BOUND_MS,
      signal,
      () => this.firstUnboundRefusal(),
    )
  }

  /** Whether every stop is verified in its context; a stop the adapter refused fails at once. */
  private assertAllBound(): boolean {
    let allBound = true
    for (const logical of this.registry.logical) {
      const state = this.registry.bindingOf(
        logical,
        this.sessionsOf(logical.stop.context),
      )
      if (state === 'refused') throw this.notBound(logical)
      if (state === 'pending') allBound = false
    }
    return allBound
  }

  private notBound(logical: LogicalExtensionStop): StudyError {
    const where = logical.stop.context === 'page' ? 'page' : 'service worker'
    return new StudyError(
      'STOP_NOT_BOUND',
      `Stop ${logical.stop.index} could not be set in the ${where}.`,
    )
  }

  /** The refusal for the first stop that is still not verified when the bound ends. */
  private firstUnboundRefusal(): StudyError {
    const logical = this.registry.logical.find(
      (entry) =>
        !entry.retired &&
        this.registry.bindingOf(entry, this.sessionsOf(entry.stop.context)) !==
          'bound',
    )
    if (!logical) return this.workerNotAttached()
    const hasWorker = this.entriesOf('worker').length > 0
    return logical.stop.context === 'service-worker' && !hasWorker
      ? this.workerNotAttached()
      : this.notBound(logical)
  }

  async ensureWorkerReady(signal: AbortSignal): Promise<void> {
    if (!this.input.run.workerPath) return
    if (this.entriesOf('worker').length === 0) {
      // The worker went idle: Codebook starts it again before the click (SR1).
      this.recordIntervention('start-worker')
      await this.input.startWorker()
      await this.waitForWorker(signal)
    }
    await this.waitOr(
      () => this.workerStopsBound(),
      'the worker stops to be verified',
      EXTENSION_WAKE_BOUND_MS,
      signal,
      () => this.firstUnboundRefusal(),
    )
  }

  // ---------------------------------------------------------------- bookkeeping and release

  interventions(): readonly ExtensionIntervention[] {
    return this.interventionList
  }

  recordIntervention(kind: string): void {
    const time = new Date(this.now()).toISOString()
    this.interventionList.push({ kind, time })
    this.input.record('chrome-extension.intervention', { kind, time })
  }

  release(): Promise<void> {
    const attempt = (this.releasing ??= this.releaseOwned())
    return attempt.catch((error: unknown) => {
      // A failed release is dropped, so the next call runs it again.
      if (this.releasing === attempt) this.releasing = undefined
      throw error
    })
  }

  /** Removes the breakpoints, ends the sessions this run started and stops listening; repeatable after a failure. */
  private async releaseOwned(): Promise<void> {
    this.releaseBegun = true
    this.abort.abort()
    for (const timer of this.holdTimers.values()) clearTimeout(timer)
    this.holdTimers.clear()
    this.output.finish()
    this.registry.removeAll()
    const sessions = [...this.entries.values()].map((entry) => entry.session)
    const results = await Promise.allSettled(
      sessions.map((session) => vscode.debug.stopDebugging(session)),
    )
    for (const session of sessions) codebookStopLedger.forget(session.id)
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    this.tracker.dispose()
    this.termination.dispose()
  }
}

/**
 * Creates the editor-backed debugger of one chrome-extension run.
 * Called by the run's dependencies when its preparation starts; nothing attaches until the run calls `attach`.
 * @param input - The run id, the resolved run, the owned browser's port and surface, and the journal.
 * @returns The debugger, listening to the editor's debug sessions of this run only.
 * @example
 * const debug = createVscodeChromeExtensionDebugger({ runId, workspace, run, port, surfaceTargetId, targetUrlOf, startWorker, assertSourcesUnchanged, roots, record })
 * await debug.attach(signal)
 */
export function createVscodeChromeExtensionDebugger(
  input: ExtensionDebuggerInput,
): ChromeExtensionDebugger {
  return new VscodeChromeExtensionDebugger(input)
}
