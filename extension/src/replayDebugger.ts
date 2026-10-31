import { randomUUID } from 'node:crypto'

import type * as vscode from 'vscode'

import {
  NATIVE_DEBUG_FOCUS_SESSION_COMMAND,
  REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  REPLAY_DEBUG_INSPECTION_GRACE_MS,
  REPLAY_DEBUG_SESSION_NAME,
  REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS,
  REPLAY_DEBUG_TYPE,
} from './constants'
import { ReplayDebuggerStartError } from './errors'
import {
  ReplayDebugAdapter,
  type ReplayRecordedInspection,
  type ReplaySourceDocument,
} from './replayDebugAdapter'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { untilAborted } from './utils/untilAborted'

const HISTORICAL_DEBUGGER_CLOSED =
  'Historical debugger closed. Reopen the learning replay to restore it.'
const HISTORICAL_PRESENTATION_SUPERSEDED =
  'Historical debugger presentation was superseded.'

/** Whether native Run and Debug loaded a presented moment's recorded values before the moment committed; `'no-values'` marks a gap or scope-less stop with nothing to load. */
export type ReplayInspection = 'inspected' | 'uninspected' | 'no-values'

/** Why {@link ReplayDebugger} asks the reader to re-evaluate its Run and Debug hint and Node debugger availability. */
export type ReplayDebuggerChange = 'values-loaded' | 'session-ended'

/** What {@link ReplayDebugger.awaitRetrieval} waits for the native client to retrieve: the current stack, its inspection frame's scopes, or the first scope's values. */
export type ReplayRetrievalStage = 'stack' | 'scopes' | 'values'

/** How one {@link ReplayDebugger} inspection wait ends: with a presentation outcome or with the error that ended it. */
type InspectionOutcome = { inspection: ReplayInspection } | { error: unknown }

/** Owns the selected native historical session for {@link StudyWorkspace}; never adopts or stops another debugger. @example await debuggerView.present(snapshot, 'Recorded · 00:42', signal) // => 'uninspected' while Variables is collapsed */
export class ReplayDebugger {
  private readonly token = randomUUID()
  private readonly disposables: vscode.Disposable[] = []
  /** The timers of {@link notifyValuesLoaded} that have not told the reader yet; {@link releaseAdapterAndListeners} clears them. */
  private readonly valuesLoadedTimers = new Set<ReturnType<typeof setTimeout>>()
  private session?: vscode.DebugSession
  private adapter?: ReplayDebugAdapter
  private starting?: Promise<void>
  private retiring?: Promise<void>
  private retiringSessionId?: string
  /** The session {@link stopSessionStartedAfterExpiry} already asked the editor to stop, so expiry and a late startup stop it only once. */
  private expiredSessionStopped?: vscode.DebugSession
  /** The startup outlived its bound while no one ended the session, so {@link adoptLateStartup} may still take the session over once the editor finishes starting it. */
  private startupExpired = false
  private closed = false
  private detached = false
  private revision = 0
  private selected?: {
    snapshot: ReplayDebugSnapshot | undefined
    label: string
    sourceUri?: string
    inspections?: readonly ReplayRecordedInspection[]
  }
  /** The selection ({@link selected}) whose native model needs no more selecting: {@link runNativeInspectionModelSelection} settles it once the host accepted {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND} for it while it was still the shown selection, and {@link selectNativeInspectionModel} settles it when the host registers no such command. A refusal of the host leaves it unsettled, so the stop's next frame asks again (Cycle 0046 AD25). A later frame of a settled selection does not select it again ({@link hasSettledModelSelection}, asked at the frame's entry and again right before the command, Q1); a new selection is a new object and is selected once. */
  private modelSelectionSettledFor?: ReplayDebugger['selected']
  /** The model selection the host still answers ({@link runNativeInspectionModelSelection}): the selection it is for, and whether the host selected the model. A newer frame of the same stop waits for this answer instead of asking again, also when the presentation that asked was superseded or abandoned (Cycle 0046 AD25). */
  private modelSelectionInFlight?: {
    selection: ReplayDebugger['selected']
    answer: Promise<boolean>
  }
  /** Positive discovery of {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND}, kept for this owner by {@link nativeInspectionCommands}, so later stops need no catalog roundtrip; a host that did not register it is asked again at its next new selection. */
  private registeredNativeFocusCommand = false
  private hasPresented = false
  private lastPresentedSnapshot?: ReplayDebugSnapshot
  /** The last committed moment's values were not loaded and native Run and Debug has requested none since. */
  private valuesUnrequested = false
  /** Pending {@link awaitInspection} and {@link awaitRetrieval} checks, re-run whenever the native client's request was served, values load, a `stopped` event is sent or ownership changes. */
  private readonly inspectionWaiters = new Set<() => void>()
  /** Default native model resolution is allowed only for an observed launch cohort that began without another active debugger. */
  private nativeSessionsObservedFromEmptyContext = false
  /** Other sessions observed by {@link trackNativeSessionOwnership}; they may pause without taking the selected frame. */
  private readonly competingNativeSessions = new Set<string>()

  /**
   * Registers the owned historical debug adapter for {@link StudyWorkspace}.
   * @param editor - VS Code API surface used to start, observe and stop the owned session.
   * @param changed - Runs {@link REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS} after native Run and Debug loaded the selected stop's values, and when the learner ends the owned session, so the reader can drop a stale hint and re-enable Node Inspect.
   * @param failed - Receives an error the `changed` listener throws, while handling a values-loaded notification or while this owner gives up, and the host's refusal of a native model selection, which fails no frame (Cycle 0046 AD25); the native session never sees it.
   * @example new ReplayDebugger(vscode, (reason) => this.replayDebuggerChanged(reason), (error) => this.report('replay-debugger', error))
   */
  constructor(
    private readonly editor: Pick<
      typeof vscode,
      'EventEmitter' | 'DebugAdapterInlineImplementation'
    > & {
      commands?: Pick<typeof vscode.commands, 'getCommands'> & {
        executeCommand: (
          ...arguments_: Parameters<typeof vscode.commands.executeCommand>
        ) => ReturnType<typeof vscode.commands.executeCommand>
      }
      debug: Pick<
        typeof vscode.debug,
        | 'registerDebugAdapterDescriptorFactory'
        | 'onDidTerminateDebugSession'
        | 'startDebugging'
        | 'stopDebugging'
      > &
        // Optional so an editor surface without the focused stack item (a test port) keeps the full grace.
        Partial<
          Pick<
            typeof vscode.debug,
            'activeStackItem' | 'activeDebugSession' | 'onDidStartDebugSession'
          >
        >
    },
    private readonly changed: (reason: ReplayDebuggerChange) => void = () => {},
    private readonly failed: (error: unknown) => void = () => {},
  ) {
    this.trackNativeSessionOwnership()
    this.disposables.push(
      this.editor.debug.registerDebugAdapterDescriptorFactory(
        REPLAY_DEBUG_TYPE,
        {
          createDebugAdapterDescriptor: (session) => {
            // A learner-stopped owner stays detached: an editor relaunch would otherwise be adopted without history. A startup that outlived its bound is still this owner's own launch, so its adapter is served and adoptLateStartup takes the session over.
            if (
              this.closed ||
              (this.detached && !this.startupExpired) ||
              session.configuration.codebookReplayOwner !== this.token ||
              this.session
            )
              throw new Error(
                'Open historical debugging through Codebook learning replay.',
              )
            const events =
              new this.editor.EventEmitter<vscode.DebugProtocolMessage>()
            this.session = session
            const adapter: ReplayDebugAdapter = (this.adapter =
              new ReplayDebugAdapter(
                (message) => {
                  events.fire(message)
                  // The grace for loading values starts when native Run and Debug learns about the stop.
                  if ('event' in message && message.event === 'stopped')
                    this.wakeInspection()
                },
                () => {
                  // Codebook's own stop-change retirement disconnects before termination; only another stop makes history unavailable.
                  if (this.retiringSessionId !== session.id) {
                    this.detached = true
                    // A session the learner stopped is never adopted back after a slow startup.
                    this.startupExpired = false
                  }
                  this.wakeInspection()
                },
                () => {
                  // Values now load, so later stops wait for them again and the reader drops its hint.
                  if (this.adapter !== adapter) return
                  this.valuesUnrequested = false
                  this.wakeInspection()
                  this.notifyValuesLoaded(adapter)
                },
                (error) => this.failed(error),
              ))
            return new this.editor.DebugAdapterInlineImplementation({
              onDidSendMessage: events.event,
              handleMessage: (message) => {
                adapter.handleMessage(message)
                // A served request may be the one a wait is for (the presented stop's scopes), and only the adapter knows which.
                this.wakeInspection()
              },
              dispose: () => {
                adapter.dispose()
                events.dispose()
              },
            })
          },
        },
      ),
    )
    this.disposables.push(
      this.editor.debug.onDidTerminateDebugSession((session) => {
        this.competingNativeSessions.delete(session.id)
        if (session.id !== this.session?.id) return
        this.forgetEndedSession()
        // Codebook retiring its own session to change stops keeps the learner's Run and Debug layout, so values stay unrequested and the hint stays.
        if (session.id === this.retiringSessionId) {
          this.detached = false
          this.starting = undefined
          return
        }
        this.valuesUnrequested = false
        // The reader's listener and its error channel may both throw; neither may escape into the editor's event loop. When both do, the owner is already detached, which is the signal that remains.
        this.tellReader('session-ended')
      }),
    )
  }

  /** Watches public native starts for {@link selectNativeInspectionModel}; the constructor treats an already active debugger as an unknown cohort and keeps its native choices. @example this.trackNativeSessionOwnership() // competing starts disable default historical selection */
  private trackNativeSessionOwnership(): void {
    const started = this.editor.debug.onDidStartDebugSession
    this.nativeSessionsObservedFromEmptyContext = Boolean(
      started && !this.editor.debug.activeDebugSession,
    )
    if (!started) return
    this.disposables.push(
      started((session) => {
        // The configuration owner distinguishes our own pending launch before its adapter is adopted.
        if (session.configuration.codebookReplayOwner === this.token) return
        this.competingNativeSessions.add(session.id)
      }),
    )
  }

  /**
   * Drops everything this owner held of its native session once the editor reports that session terminated, so nothing presents on the ended adapter; called by the termination listener of the constructor before it tells Codebook's own retirement from the learner's stop.
   * @example this.forgetEndedSession() // this.session === undefined, this.detached === true
   */
  private forgetEndedSession(): void {
    // A replacement adapter starts empty, so the next presentation must select its stop again.
    this.adapter?.dispose()
    this.adapter = undefined
    this.session = undefined
    this.detached = true
    this.startupExpired = false
    this.selected = undefined
    // A wait on the ended adapter fails now instead of at its deadline.
    this.wakeInspection()
  }

  /**
   * Tells the reader of a change from inside an editor callback, where nothing may be thrown: the termination listener of the constructor and the timer of {@link notifyValuesLoaded} call it.
   * A listener that throws reaches the reader's error channel, and an error channel that throws as well is swallowed.
   * @param change - What the reader is told.
   * @example this.tellReader('values-loaded')
   */
  private tellReader(change: ReplayDebuggerChange): void {
    try {
      this.changed(change)
    } catch (error) {
      try {
        this.failed(error)
      } catch {
        // The error channel failed as well; nothing may escape into the editor's event loop or its timer queue.
      }
    }
  }

  /**
   * Tells the reader that native Run and Debug loaded the presented stop's values, {@link REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS} after the adapter served them; called by the adapter's `inspected` callback.
   *
   * The adapter knows when it answered the request, not when native Variables drew the rows, so the reader's own repaint (its hint
   * leaving) is kept apart from that view's. A stop that is no longer the presented one by then is not reported, and a listener
   * that throws reaches the reader's error channel, as it did from inside the adapter.
   *
   * @param adapter - The adapter that served the values.
   * @example this.notifyValuesLoaded(adapter)
   */
  private notifyValuesLoaded(adapter: ReplayDebugAdapter): void {
    const timer = setTimeout(() => {
      this.valuesLoadedTimers.delete(timer)
      // A reader told late about a stop it no longer shows would drop the hint of the stop it does show.
      if (!this.stillPresentsLoadedValues(adapter)) return
      this.tellReader('values-loaded')
    }, REPLAY_DEBUG_VALUES_PAINT_ALLOWANCE_MS)
    this.valuesLoadedTimers.add(timer)
  }

  /**
   * Says whether the stop whose values an adapter served is still the presented one when the paint allowance has passed; asked by the timer of {@link notifyValuesLoaded} before it tells the reader.
   * @param adapter - The adapter that served the values.
   * @returns `true` while this owner is open, still uses that adapter, and the adapter's presented stop has its loadable values inspected; `false` otherwise.
   * @example this.stillPresentsLoadedValues(adapter) // => false after the owner was disposed
   */
  private stillPresentsLoadedValues(adapter: ReplayDebugAdapter): boolean {
    return (
      !this.closed &&
      this.adapter === adapter &&
      adapter.inspectionReady &&
      adapter.hasLoadableValues
    )
  }

  /** Reports whether playback may still present history; false after the learner stops the owned session or a startup or presentation bound expired, so the next explicit replay open, or an explicit selection or Inspect of a test replay's stop, replaces this owner ({@link ReplayDebuggerSlot.replaceUnavailable}); a seek or Play never does. @example if (!debuggerView.available) await debuggerView.dispose() */
  get available(): boolean {
    return !this.closed && !this.detached
  }

  /**
   * Clears native state immediately when {@link StudyWorkspace}'s playback retires the displayed bundle: a pending seek, a hidden or covered replay surface, or closing.
   * @param label - What the emptied session's thread and stop description read; the default says that nothing is recorded at the moment, and a caller whose moment is recorded but hidden says so instead.
   * @example debuggerView.invalidate('Recorded application is covered by another tab')
   */
  invalidate(label = 'Not recorded at this moment'): void {
    this.revision++
    this.wakeInspection()
    this.selected = undefined
    this.adapter?.select(undefined, label)
  }

  /**
   * Retires the owned session before {@link StudyWorkspace.presentPlayback} shows a different historical stop; video frames within one stop keep their native context.
   *
   * The retirement is shared by every presentation and bounded by {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS}, counted once any
   * pending startup has settled: an editor that never answers makes this owner unavailable, so only an explicit replay
   * reopen restarts it. An aborted caller leaves at once.
   *
   * @param snapshot - Recorded stop about to be shown, compared with the one the session shows now.
   * @param signal - The presentation's cancellation; it never cancels the shared retirement.
   * @throws The signal's reason once it aborts, or the closed-debugger error when this owner is or becomes unavailable.
   * @example await debuggerView.retire(snapshot, signal)
   */
  async retire(
    snapshot: ReplayDebugSnapshot | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    if (this.closed || this.detached)
      throw new Error(HISTORICAL_DEBUGGER_CLOSED)
    if (this.hasPresented && this.lastPresentedSnapshot === snapshot) return
    this.retiring ??= this.retireAfterStartup().finally(() => {
      this.retiring = undefined
    })
    await untilAborted(this.retiring, signal)
    signal.throwIfAborted()
  }

  /**
   * Runs the shared retirement for {@link retire} once a pending startup has settled, so each of the two gets its own bound.
   *
   * A seek during a slow cold start would otherwise expire a healthy owner: the startup and the stop together can outlast
   * one {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS} although neither does alone.
   *
   * @throws The closed-debugger error when the owner closed or gave up during that startup, or when the retirement outlives its bound.
   * @example this.retiring ??= this.retireAfterStartup()
   */
  private async retireAfterStartup(): Promise<void> {
    await this.starting?.catch(() => {})
    // An owner that gave up on its startup has no session of its own left to retire; launchSession stops one that starts late.
    if (this.closed || this.detached)
      throw new Error(HISTORICAL_DEBUGGER_CLOSED)
    await this.bounded(this.retireSession())
  }

  /**
   * Stops the owned session and waits for its termination on behalf of {@link retireAfterStartup}.
   * @example await this.bounded(this.retireSession())
   */
  private async retireSession(): Promise<void> {
    const session = this.session
    if (!session) return
    this.retiringSessionId = session.id
    try {
      await this.editor.debug.stopDebugging(session)
      await waitUntil(
        () => this.session?.id !== session.id,
        'owned historical debugger termination',
        REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
        new AbortController().signal,
      )
    } finally {
      // An expired retirement already gave up this session; a later one may own the field by now.
      if (this.retiringSessionId === session.id)
        this.retiringSessionId = undefined
    }
  }

  /**
   * Bounds one shared native operation (startup or retirement) by {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS}.
   *
   * On expiry the owner gives up its session through {@link giveUp}, so every waiter and later presentation fails with the
   * closed-debugger error instead of waiting for an editor that never answers.
   *
   * @param operation - The shared operation; it keeps running, and its late outcome is ignored except for a startup that {@link adoptLateStartup} takes over.
   * @param isStartup - Whether the operation launches the owned session, which a healthy but slow editor may still finish.
   * @returns The operation's outcome, or a rejection with the closed-debugger error on expiry.
   * @example this.starting = this.bounded(this.launchSession(), true)
   */
  private bounded(operation: Promise<void>, isStartup = false): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (isStartup) this.startupExpired = true
        this.giveUp()
        // A session still alive after its retirement expired would keep showing history: ask again, as the first stop may be lost. A slow startup is left for adoptLateStartup.
        if (!isStartup) this.stopSessionStartedAfterExpiry()
        reject(new Error(HISTORICAL_DEBUGGER_CLOSED))
      }, REPLAY_DEBUG_CAPTURE_TIMEOUT_MS)
    })
    return Promise.race([operation, expiry]).finally(() => clearTimeout(timer))
  }

  /**
   * Gives up ownership through {@link expire} on behalf of {@link bounded} and {@link present}, keeping a reader listener that throws away from their waiters.
   *
   * The listener's error goes to the reader's error channel instead, so the expired operation still rejects with the closed-debugger error.
   * This method never throws: its callers reject or throw that closed-debugger error right after it.
   *
   * @example this.giveUp()
   */
  private giveUp(): void {
    try {
      this.expire()
    } catch (error) {
      try {
        this.failed(error)
      } catch {
        // The reader's error channel failed as well; the closed-debugger error the caller raises next is the signal that remains.
      }
    }
  }

  /**
   * Makes this owner unavailable after a shared native operation outlived its bound or the editor disposed its adapter, as if the learner had stopped it.
   *
   * A termination that arrives later is then the learner-ended path rather than Codebook's own retirement, and a session that
   * starts later is stopped by {@link launchSession}. The reader drops its hint and re-enables Node Inspect.
   *
   * An adapter the editor already disconnected still gives up here: its retiring session would otherwise survive, and the
   * late termination would make this owner available again without the explicit reopen. The reader is notified every time,
   * because that termination may never arrive.
   *
   * @example this.expire()
   */
  private expire(): void {
    if (this.closed) return
    this.detached = true
    this.retiringSessionId = undefined
    this.valuesUnrequested = false
    this.wakeInspection()
    this.changed('session-ended')
  }

  /**
   * Selects a recorded stop in the owned native session, then briefly waits for native Run and Debug to load its values.
   *
   * {@link StudyWorkspace.presentPlayback} awaits it before a recorded frame commits, so visible Variables normally appear
   * with the frame; {@link StudyWorkspace.selectNodeHistoryEvent} awaits it for saved Node stops. A hidden Variables view or
   * a focused foreign session never requests values, so after {@link REPLAY_DEBUG_INSPECTION_GRACE_MS} the moment still
   * commits as `'uninspected'`. Later moments then commit at once until the native client requests values again.
   *
   * @param snapshot - Recorded stop to show, or `undefined` for missing history.
   * @param label - Native thread label that identifies the recorded moment.
   * @param signal - Cancels this presentation without stopping the owned session.
   * @param sourceDocument - Captured source the native editor should open for the stop.
   * @param inspections - The stop's recorded inspections, listed in one extra read-only native scope; pass the same array for the same stop so a repeated presentation is not re-selected.
   * @returns
   * - `'inspected'` when current stack, scopes and first values were retrieved
   * - `'uninspected'` when the grace elapsed first, or at once while Run and Debug still loads no values
   * - `'no-values'` at once for a gap or a stop without scopes, which native Variables cannot load, and as soon as a served Call Stack page shows that the frame native Run and Debug focuses has none
   * @throws When the learner stopped the owned session, the workspace closed, a newer presentation superseded this one or `signal` aborted.
   * @example
   * await debuggerView.present(snapshot, 'Recorded pause · 55.87 s', signal) // => 'inspected'
   */
  async present(
    snapshot: ReplayDebugSnapshot | undefined,
    label: string,
    signal: AbortSignal,
    sourceDocument?: ReplaySourceDocument,
    inspections?: readonly ReplayRecordedInspection[],
  ): Promise<ReplayInspection> {
    signal.throwIfAborted()
    if (this.closed || this.detached)
      throw new Error(HISTORICAL_DEBUGGER_CLOSED)
    const revision = ++this.revision
    // A newer presentation supersedes any older wait at once.
    this.wakeInspection()
    await this.awaitSession(signal)
    signal.throwIfAborted()
    if (this.closed || this.detached || revision !== this.revision)
      throw new Error(HISTORICAL_PRESENTATION_SUPERSEDED)
    const adapter = this.adapter!
    // A duplicate selection may share pending inspection, but cannot bypass its readiness boundary.
    if (
      !this.selected ||
      this.selected.snapshot !== snapshot ||
      this.selected.label !== label ||
      this.selected.sourceUri !== sourceDocument?.uri ||
      this.selected.inspections !== inspections
    ) {
      // A select that throws must not leave this stop recorded as shown, so presenting it again selects it again.
      this.selected = undefined
      adapter.select(snapshot, label, sourceDocument, inspections)
      this.selected = {
        snapshot,
        label,
        sourceUri: sourceDocument?.uri,
        inspections,
      }
    }
    // The editor can dispose the adapter just before it reports termination; a disposed adapter shows nothing, which is not "no values".
    this.assertAdapterAvailable(adapter)
    // The native session shows this stop from now on, so an interrupted wait cannot make retire() restart it.
    this.hasPresented = true
    this.lastPresentedSnapshot = snapshot
    // Gaps and scope-less stops have nothing for Variables to load: commit at once and leave the session-level state alone.
    if (!adapter.hasLoadableValues) return 'no-values'
    await this.selectNativeInspectionModel(adapter, revision, signal)
    // While Run and Debug requests no values, waiting on every stop would stall playback without ever loading them.
    // A paused frame of another session keeps the Run and Debug focus, so this stop's values are not requested either: the grace would only delay the frame.
    const inspection = adapter.inspectionReady
      ? 'inspected'
      : this.nativeValuesRemainUnrequested()
        ? 'uninspected'
        : await this.awaitInspection(adapter, revision, signal)
    signal.throwIfAborted()
    // Only a loaded Variables page (the adapter's report) clears this; a gap or scope-less stop proves nothing about Variables.
    if (inspection === 'uninspected') this.valuesUnrequested = true
    return inspection
  }

  /**
   * Waits until native Variables retrieved the presented stop's scopes or its first values, on behalf of {@link StudyWorkspace.showNativeVariables}, without polling.
   *
   * A Variables view that was hidden while the stop changed loads it only in its own deferred refresh (400 ms after it is shown
   * again in VS Code 1.140); its tree holds no row of the stop until then. The adapter serving `scopes` for the stop's inspection
   * frame is the earliest moment that tree can hold those rows, and serving the first scope's `variables` is the moment they are listed.
   *
   * @param stage - `'stack'` for the current stack receipt, `'scopes'` for the inspection frame's scopes, `'values'` for everything {@link ReplayDebugAdapter.inspectionReady} requires.
   * @param timeoutMs - Longest wait; a view that shows another session, or a host that never asks, ends it there.
   * @returns
   * - `true` once native Variables retrieved that stage of the presented stop (at once when it already had)
   * - `false` when `timeoutMs` elapsed first, or at once when the owned session ends: the reader closed, the learner stopped it, or Codebook restarts it for another stop
   * @example
   * await debuggerView.awaitRetrieval('scopes', 2_000) // => true about 400 ms after a hidden Variables view is shown
   */
  awaitRetrieval(
    stage: ReplayRetrievalStage,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (retrieved: boolean): void => {
        clearTimeout(timer)
        this.inspectionWaiters.delete(check)
        resolve(retrieved)
      }
      const check = (): void => {
        // An ended session answers no request, so nothing is left to wait for; the next stop's session is another press's concern.
        if (this.closed || this.detached) return finish(false)
        if (this.hasRetrieved(stage)) finish(true)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      this.inspectionWaiters.add(check)
      check()
    })
  }

  /**
   * Tells a pending {@link awaitRetrieval} check whether native Variables retrieved the stage it waits for.
   * @param stage - `'stack'` for the current stack receipt, `'scopes'` for the inspection frame's scopes, `'values'` for everything {@link ReplayDebugAdapter.inspectionReady} requires.
   * @returns The adapter's answer for that stage; `undefined` while no adapter is held.
   * @example this.hasRetrieved('scopes') // => true once the adapter served the stop's scopes
   */
  private hasRetrieved(stage: ReplayRetrievalStage): boolean | undefined {
    const adapter = this.adapter
    if (!adapter) return undefined
    return {
      stack: adapter.stackRetrieved,
      scopes: adapter.scopesRetrieved,
      values: adapter.inspectionReady,
    }[stage]
  }

  /**
   * Selects the current owned native model after its real stack receipt without borrowing editor keyboard focus; {@link present} calls it before inspection for every presented frame of a stop with loadable values.
   * It runs once per selection ({@link modelSelectionSettledFor}): during Play the frames of one stop share their selection, and asking the host for its commands and running {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND} again for each frame would repeat a model selection the host already made. A selection whose model was not selected (its stack not fetched within the grace, another debugger beside it, a presentation abandoned before the command ran, the host's refusal of the command) is tried again at its next frame.
   * The command, once run, is the stop's and not the presentation's ({@link runNativeInspectionModelSelection}, Cycle 0046 AD25): a newer frame of the same stop waits for its answer instead of running it again, and the answer settles the stop's selection also when the presentation that ran it was superseded or abandoned meanwhile. A refusal of the host is a view selection that did not happen: it fails no frame and pauses no Play; it goes to the reader's error channel, and the selection stays unsettled.
   * @param adapter - Adapter owning this selection.
   * @param revision - Presentation that must still own the model.
   * @param signal - Cancels an outdated selection.
   * @example await this.selectNativeInspectionModel(adapter, revision, signal)
   */
  private async selectNativeInspectionModel(
    adapter: ReplayDebugAdapter,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> {
    const selection = this.selected
    // A later frame of the same stop: its model was selected already, or the host has no command for it.
    if (this.hasSettledModelSelection(selection)) return
    const commands = await this.nativeInspectionCommands(signal)
    signal.throwIfAborted()
    // Even an unsupported-command answer may arrive after another moment was selected.
    this.assertInspectionOwnership(adapter, revision)
    if (!commands) {
      this.modelSelectionSettledFor = selection
      return
    }
    const stackRetrieved = await untilAborted(
      this.awaitRetrieval('stack', REPLAY_DEBUG_INSPECTION_GRACE_MS),
      signal,
    )
    signal.throwIfAborted()
    this.assertInspectionOwnership(adapter, revision)
    if (!stackRetrieved) return
    // Null means no explicit session and avoids older Cursor's undefined-parent match; only an unambiguous owned cohort may use the native default resolver.
    if (!this.canSelectNativeInspectionModel()) return
    // Asked again after the last await: another frame's answer may have settled the selection, and cleared it from flight, while this frame waited (Cycle 0046 Q1).
    if (this.hasSettledModelSelection(selection)) return
    // A selection the host still answers for this stop is this frame's too.
    const inFlight = this.modelSelectionInFlight
    const answer =
      inFlight && inFlight.selection === selection
        ? inFlight.answer
        : this.runNativeInspectionModelSelection(commands, selection)
    await untilAborted(answer, signal)
    this.assertInspectionOwnership(adapter, revision)
  }

  /**
   * Says whether a selection's native model needs no more selecting, for {@link selectNativeInspectionModel} at a frame's entry and again right before it starts {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND}, with no await in between.
   * @param selection - The selection the frame presents, or none.
   * @returns `true` when {@link modelSelectionSettledFor} is this selection; `false` for no selection or one not settled yet.
   * @example this.hasSettledModelSelection(this.selected) // => true once the host accepted the stop's focusProcess
   */
  private hasSettledModelSelection(
    selection: ReplayDebugger['selected'],
  ): boolean {
    return (
      selection !== undefined && this.modelSelectionSettledFor === selection
    )
  }

  /**
   * Runs {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND} for a selection and settles the selection by the host's answer, whatever becomes of the presentation that asked; called by {@link selectNativeInspectionModel}, which keeps the answer in {@link modelSelectionInFlight} for later frames of the stop.
   * @param commands - The editor's command port.
   * @param selection - The selection whose model is selected.
   * @returns `true` once the host selected the model, which settles the selection while it is still the current one; `false` when the host refused the command, which leaves it unsettled for the next frame and reports the refusal on the reader's error channel.
   * @throws The bound's timeout when the host did not answer within {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS}, as before: the frame that waits fails within its bound.
   * @example await this.runNativeInspectionModelSelection(commands, this.selected) // => true
   */
  private runNativeInspectionModelSelection(
    commands: NonNullable<
      Awaited<ReturnType<ReplayDebugger['nativeInspectionCommands']>>
    >,
    selection: ReplayDebugger['selected'],
  ): Promise<boolean> {
    // The host's refusal of the command is a view selection that did not happen: no frame fails for it.
    const command = Promise.resolve(
      commands.executeCommand(NATIVE_DEBUG_FOCUS_SESSION_COMMAND, null),
    ).then(
      () => true,
      (error: unknown) => {
        try {
          this.failed(error)
        } catch {
          // The reader's error channel failed as well; the next frame tries the selection again.
        }
        return false
      },
    )
    // An unanswered command still ends within its bound and fails the frame that waits for it.
    const answer = awaitResponse(
      command,
      'native historical model selection',
      undefined,
      REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
    )
      .then((selected) => {
        // A later moment may have been selected meanwhile; only the still current selection is settled.
        if (selected && this.selected === selection)
          this.modelSelectionSettledFor = selection
        return selected
      })
      .finally(() => {
        if (this.modelSelectionInFlight?.answer === answer)
          this.modelSelectionInFlight = undefined
      })
    this.modelSelectionInFlight = { selection, answer }
    return answer
  }

  /**
   * Resolves supported native model commands within the ordinary native-operation bound for {@link selectNativeInspectionModel}.
   * A positive answer is kept for this owner ({@link registeredNativeFocusCommand}): the command is the workbench's own and stays registered while the editor runs, so later stops ask the host's catalog no more.
   * @param signal - Cancels an abandoned presentation.
   * @returns The editor command port only when it registers the native selection entry.
   * @example await this.nativeInspectionCommands(signal) // => undefined on an unsupported host
   */
  private async nativeInspectionCommands(signal: AbortSignal) {
    const commands = this.editor.commands
    if (!commands) return undefined
    // Discovery cannot delay a later stop once this owner found the command.
    if (this.registeredNativeFocusCommand) return commands
    const supported = await untilAborted(
      awaitResponse(
        commands.getCommands(true),
        'native historical model command availability',
        signal,
        REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
      ),
      signal,
    )
    if (supported?.includes(NATIVE_DEBUG_FOCUS_SESSION_COMMAND))
      this.registeredNativeFocusCommand = true
    return this.registeredNativeFocusCommand ? commands : undefined
  }

  /** Rejects a lost historical owner before and after the native model request in {@link selectNativeInspectionModel}. @param adapter - Adapter serving the expected moment. @param revision - Expected presentation. @throws The existing closed or superseded presentation error after ownership changes. @example this.assertInspectionOwnership(adapter, revision) */
  private assertInspectionOwnership(
    adapter: ReplayDebugAdapter,
    revision: number,
  ): void {
    const ownershipError = this.ownershipError(adapter, revision)
    if (ownershipError) throw ownershipError
  }

  /** Rejects a disposed native adapter in {@link present} before a recorded stop can be treated as displayed; only an explicit reopen replaces its expired owner. @param adapter - Adapter selected for presentation. @throws The historical debugger closed error after native disposal. @example this.assertAdapterAvailable(adapter) */
  private assertAdapterAvailable(adapter: ReplayDebugAdapter): void {
    if (!adapter.disposed) return
    this.giveUp()
    throw new Error(HISTORICAL_DEBUGGER_CLOSED)
  }

  /** Preserves a foreign native debugger choice after readiness in {@link selectNativeInspectionModel}. @returns Whether the current native session still belongs to this historical owner without a foreign selected frame. @example this.ownsNativeInspectionModel() // => false after the learner selects another session */
  private ownsNativeInspectionModel(): boolean {
    return Boolean(
      this.session &&
      this.editor.debug.activeDebugSession?.id === this.session.id &&
      !this.foreignPauseFocused(),
    )
  }

  /** Keeps {@link selectNativeInspectionModel} from using an ambiguous default resolver: older Cursor accepts null for an unspecified session, but every host can choose another paused session when more than one is present. @returns Whether current ownership and the observed native cohort both permit default selection. @example this.canSelectNativeInspectionModel() // => false after another native debugger starts */
  private canSelectNativeInspectionModel(): boolean {
    return this.ownsNativeInspectionModel() && this.nativeSelectionIsExclusive()
  }

  /** Checks the public lifecycle cohort for {@link canSelectNativeInspectionModel}; an initially active session is never guessed to be the only one. @returns Whether observation began without another active debugger and no competing native start remains. @example this.nativeSelectionIsExclusive() // => false while a learner session is alive */
  private nativeSelectionIsExclusive(): boolean {
    return (
      this.nativeSessionsObservedFromEmptyContext &&
      this.competingNativeSessions.size === 0
    )
  }

  /** Keeps {@link present} from waiting again while Variables remains unrequested or the learner holds another paused session. @returns Whether the current stop should commit truthfully without an inspection wait. @example this.nativeValuesRemainUnrequested() // => true with a foreign focused pause */
  private nativeValuesRemainUnrequested(): boolean {
    return this.valuesUnrequested || this.foreignPauseFocused()
  }

  /**
   * Says whether a paused thread or frame of another debug session holds the focus of native Run and Debug, on behalf of {@link present}.
   *
   * The editor gives that focus to a newly stopped session only when nothing is focused or the focused frame is that
   * session's own. While a learner's or a live run's pause is focused, Variables therefore keeps showing that pause and
   * never requests the recorded stop's values, until the learner selects the recorded session in Call Stack. Pressing
   * Recording on a paused live run's own recording is that case every time; waiting {@link REPLAY_DEBUG_INSPECTION_GRACE_MS}
   * there added one second to each reload.
   *
   * @returns `true` while another session's paused thread or frame is the focused stack item; `false` when nothing is focused, the focus is this owner's session, or the editor surface does not report it.
   * @example
   * this.foreignPauseFocused() // => true while "Next.js: debug server-side" is paused and selected in Call Stack
   */
  private foreignPauseFocused(): boolean {
    const focused = this.editor.debug.activeStackItem
    return focused !== undefined && focused.session.id !== this.session?.id
  }

  /**
   * Waits for the owned native session on behalf of {@link present}, starting it when none is running.
   *
   * Startup and retirement are shared by every presentation, so an abandoned presentation only stops waiting: its
   * signal never cancels them, and {@link PlaybackController}'s queue moves on even when the editor never answers. Both are
   * bounded by {@link bounded}, so a presentation whose signal never aborts (a saved Node stop) cannot wait forever either.
   *
   * @param signal - The waiting presentation's cancellation.
   * @throws The signal's reason once it aborts; otherwise a {@link ReplayDebuggerStartError} carrying the startup failure (which the next presentation retries) or the closed-debugger error of the startup bound's expiry: the start did not finish, this owner is no longer {@link available}, and the next explicit selection replaces and starts it again, so the move's restart clause holds.
   * @example await this.awaitSession(signal)
   */
  private async awaitSession(signal: AbortSignal): Promise<void> {
    await untilAborted(this.retiring, signal)
    if (!this.starting) {
      const starting: Promise<void> = this.bounded(
        this.launchSession(),
        true,
      ).catch((error: unknown) => {
        // A refused startup must not poison later presentations, even after every waiter left: the next one retries it.
        if (this.starting === starting && !this.session)
          this.starting = undefined
        throw error
      })
      this.starting = starting
    }
    await untilAborted(this.starting, signal).catch((error: unknown) => {
      // The waiter's own cancellation is no start failure; anything else ended the start (Cycle 0052 task 17).
      if (signal.aborted) throw error
      throw new ReplayDebuggerStartError(error)
    })
  }

  /**
   * Asks the editor to launch the owned historical session on behalf of {@link awaitSession}.
   *
   * A session that only appears after this owner closed or gave up (see {@link expire}) is stopped at once, so no
   * unowned "Codebook · Recorded learning" session keeps showing history.
   *
   * @throws When the editor refused the launch or this owner closed during it.
   * @example this.starting = this.bounded(this.launchSession())
   */
  private async launchSession(): Promise<void> {
    const started = await this.editor.debug.startDebugging(
      undefined,
      {
        type: REPLAY_DEBUG_TYPE,
        request: 'launch',
        name: REPLAY_DEBUG_SESSION_NAME,
        codebookReplayOwner: this.token,
        internalConsoleOptions: 'neverOpen',
      },
      {
        suppressSaveBeforeStart: true,
        suppressDebugToolbar: true,
        suppressDebugStatusbar: true,
      },
    )
    // A healthy startup that outlived its bound becomes this owner's session again, so the next presentation recovers without an explicit reopen.
    if (this.adoptLateStartup(started)) return
    this.stopSessionStartedAfterExpiry()
    if (!started || !this.session || !this.adapter)
      throw new Error('The editor did not start its historical debug session.')
    if (this.closed)
      throw new Error('Historical debugger closed during startup.')
  }

  /**
   * Takes over a session whose startup outlived {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS} but then completed, on behalf of {@link launchSession}.
   *
   * The expired startup already failed its waiters and made this owner unavailable; a healthy but slow editor would otherwise
   * leave replay failing until the learner reopens the recording. The editor may ask for the adapter before or after the bound
   * expired: the descriptor factory serves both. A session the learner stopped meanwhile is never adopted.
   *
   * @param started - The editor's answer to the launch.
   * @returns `true` when this owner is available again with the late session, `false` when nothing was adopted.
   * @example if (this.adoptLateStartup(started)) return
   */
  private adoptLateStartup(started: boolean): boolean {
    if (!this.startupExpired) return false
    this.startupExpired = false
    if (!this.isLateSessionUsable(started)) return false
    this.detached = false
    this.starting = Promise.resolve()
    return true
  }

  /**
   * Tells {@link adoptLateStartup} whether the launch that completed late left a session this owner can serve.
   * @param started - The editor's answer to the launch.
   * @returns `false` when the launch failed, when the owner closed meanwhile, and when no live session is held ({@link holdsLiveSession}).
   * @example this.isLateSessionUsable(true) // => false after the learner stopped the late session
   */
  private isLateSessionUsable(started: boolean): boolean {
    if (!started || this.closed) return false
    return this.holdsLiveSession()
  }

  /**
   * Tells {@link isLateSessionUsable} whether the owned session and its adapter are both still there.
   * @returns `true` while a session is held and its adapter is not disposed; `false` once the session ended or the editor disposed the adapter.
   * @example this.holdsLiveSession() // => false before the editor asked for the adapter
   */
  private holdsLiveSession(): boolean {
    if (!this.session || !this.adapter) return false
    return !this.adapter.disposed
  }

  /**
   * Stops a session that is still alive after this owner gave up on it (see {@link expire}), on behalf of {@link launchSession} and an expired retirement in {@link bounded}; each session is asked once.
   *
   * A closed owner is left to {@link dispose}, which stops the session itself once the startup settles.
   *
   * @example this.stopSessionStartedAfterExpiry()
   */
  private stopSessionStartedAfterExpiry(): void {
    const session = this.sessionAliveAfterExpiry()
    if (!session) return
    this.expiredSessionStopped = session
    void this.stopOwnedSession(session)
  }

  /**
   * Gives {@link stopSessionStartedAfterExpiry} the session it still has to stop.
   * @returns The owned session while this owner gave up on it, is not closed and has not asked that session to stop yet; `undefined` otherwise, also without a session.
   * @example this.sessionAliveAfterExpiry() // => undefined once the session was asked to stop
   */
  private sessionAliveAfterExpiry(): vscode.DebugSession | undefined {
    if (!this.detached || this.closed) return undefined
    // Each session is asked once; without a session there is none to ask.
    return this.session === this.expiredSessionStopped
      ? undefined
      : this.session
  }

  /**
   * Stops one owned session for {@link dispose} and {@link launchSession} without letting an editor that never answers hold the caller.
   * @param session - The owned historical session to stop.
   * @returns Once the stop is acknowledged or {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS} elapsed; it never rejects.
   * @example await this.stopOwnedSession(session)
   */
  private async stopOwnedSession(session: vscode.DebugSession): Promise<void> {
    await awaitResponse(
      this.editor.debug.stopDebugging(session),
      'the owned historical debugger stop',
      undefined,
      REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
    ).catch(() => {})
  }

  /**
   * Waits for native Run and Debug to load the current stop's values on behalf of {@link present}, without polling.
   *
   * The adapter's `inspected` callback, its `stopped` event and every ownership change re-run the check. The grace of
   * {@link REPLAY_DEBUG_INSPECTION_GRACE_MS} starts at the selection's `stopped` event, so a (re)started session's launch time
   * is excluded; a `stopped` event that never arrives ends the wait {@link REPLAY_DEBUG_CAPTURE_TIMEOUT_MS} after `select()`.
   *
   * @param adapter - Adapter that received the current selection.
   * @param revision - Presentation revision that owns this wait.
   * @param signal - Caller cancellation.
   * @returns `'inspected'` when retrieval completed, `'no-values'` once a served Call Stack page left the stop with an inspection frame that has no scopes, otherwise `'uninspected'` once the grace or the `stopped` deadline elapsed.
   * @throws When the session closed, a newer presentation superseded this one or `signal` aborted, each with its own error.
   * @example await this.awaitInspection(adapter, revision, signal) // => 'uninspected' while Variables is hidden
   */
  private awaitInspection(
    adapter: ReplayDebugAdapter,
    revision: number,
    signal: AbortSignal,
  ): Promise<ReplayInspection> {
    return new Promise((resolve, reject) => {
      let graceTimer: ReturnType<typeof setTimeout> | undefined,
        expired = false
      const finish = (outcome: InspectionOutcome): void => {
        clearTimeout(graceTimer)
        clearTimeout(stoppedTimer)
        signal.removeEventListener('abort', check)
        this.inspectionWaiters.delete(check)
        if ('error' in outcome) reject(outcome.error)
        else resolve(outcome.inspection)
      }
      const check = (): void => {
        const outcome = this.inspectionOutcome(
          adapter,
          revision,
          signal,
          expired,
        )
        if (outcome) return finish(outcome)
        if (graceTimer !== undefined) return
        graceTimer = this.startInspectionGrace(adapter, expire)
        // Native Run and Debug now knows about this stop; the grace from that moment replaces the stopped-event deadline.
        if (graceTimer !== undefined) clearTimeout(stoppedTimer)
      }
      const expire = (): void => {
        expired = true
        check()
      }
      // The wall clock may jump backward; the deadline never exceeds its nominal length from now.
      const stoppedTimer = setTimeout(
        expire,
        Math.min(
          REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
          Math.max(
            0,
            adapter.selectedAt + REPLAY_DEBUG_CAPTURE_TIMEOUT_MS - Date.now(),
          ),
        ),
      )
      this.inspectionWaiters.add(check)
      signal.addEventListener('abort', check, { once: true })
      check()
    })
  }

  /**
   * Decides whether one {@link awaitInspection} wait is over.
   * @param adapter - Adapter that received the waited selection.
   * @param revision - Presentation revision that owns the wait.
   * @param signal - Caller cancellation.
   * @param expired - Whether the grace or the stopped-event deadline elapsed.
   * @returns
   * - `{ error }` when the caller aborted, the session closed or a newer presentation superseded this one
   * - `{ inspection: 'no-values' }` once the stop's inspection frame is one without scopes: native Call Stack loaded its first page without a frame with source, so it focuses the top frame, which has nothing for Variables to load
   * - `{ inspection: 'inspected' }` once native Run and Debug loaded the values
   * - `{ inspection: 'uninspected' }` after a deadline without loaded values
   * - `undefined` while the wait continues
   * @example this.inspectionOutcome(adapter, revision, signal, false) // => undefined while Variables is still loading
   */
  private inspectionOutcome(
    adapter: ReplayDebugAdapter,
    revision: number,
    signal: AbortSignal,
    expired: boolean,
  ): InspectionOutcome | undefined {
    if (signal.aborted) return { error: signal.reason }
    const ownership = this.ownershipError(adapter, revision)
    if (ownership) return { error: ownership }
    // The inspection frame moves to the top frame when the first Call Stack page holds no frame with source; without scopes there, waiting out the grace would only delay the frame and leave a hint for values that do not exist.
    if (!adapter.hasLoadableValues) return { inspection: 'no-values' }
    if (adapter.inspectionReady) return { inspection: 'inspected' }
    return expired ? { inspection: 'uninspected' } : undefined
  }

  /**
   * Tells {@link inspectionOutcome} whether the waited presentation still owns the native session.
   * @returns An error naming closure or supersession, or `undefined` while this revision still owns the adapter.
   * @example this.ownershipError(adapter, revision) // => Error('Historical debugger presentation was superseded.')
   */
  private ownershipError(
    adapter: ReplayDebugAdapter,
    revision: number,
  ): Error | undefined {
    if (this.closed || this.detached || this.adapter !== adapter)
      return new Error(HISTORICAL_DEBUGGER_CLOSED)
    return revision === this.revision
      ? undefined
      : new Error(HISTORICAL_PRESENTATION_SUPERSEDED)
  }

  /**
   * Starts the grace of {@link REPLAY_DEBUG_INSPECTION_GRACE_MS} from the selection's `stopped` event, so a late waiter keeps only the remainder.
   * @param adapter - Adapter that received the waited selection.
   * @param expire - Ends the wait without loaded values.
   * @returns The grace timer, or `undefined` while native Run and Debug has not been told about the stop.
   * @example graceTimer = this.startInspectionGrace(adapter, expire)
   */
  private startInspectionGrace(
    adapter: ReplayDebugAdapter,
    expire: () => void,
  ): ReturnType<typeof setTimeout> | undefined {
    const stoppedAt = adapter.stoppedAt
    if (stoppedAt === undefined) return undefined
    // A backward wall-clock jump cannot stretch the grace beyond its nominal length.
    return setTimeout(
      expire,
      Math.min(
        REPLAY_DEBUG_INSPECTION_GRACE_MS,
        Math.max(0, stoppedAt + REPLAY_DEBUG_INSPECTION_GRACE_MS - Date.now()),
      ),
    )
  }

  /** Re-runs every pending {@link awaitInspection} and {@link awaitRetrieval} check after a native request was served, values load, a `stopped` event is sent or ownership changes. @example this.wakeInspection() */
  private wakeInspection(): void {
    for (const check of [...this.inspectionWaiters]) check()
  }

  /**
   * Stops only its exact owned session, including a startup that completes after workspace closure.
   *
   * {@link StudyWorkspace.close} and its replacement of an unavailable debugger await this, so every wait is bounded: pending
   * startup or retirement by their own {@link bounded} deadline, the final stop by {@link stopOwnedSession}. Cleanup always runs.
   *
   * @example await debuggerView.dispose()
   */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.invalidate()
    try {
      await this.retiring?.catch(() => {})
      await this.starting?.catch(() => {})
      const session = this.session
      if (session) {
        await this.stopOwnedSession(session)
        // A stop the editor never acknowledged is asked once more without holding closure, so a lost first request cannot leave the session alive.
        if (this.session === session)
          void this.editor.debug.stopDebugging(session).then(
            () => {},
            () => {},
          )
      }
    } finally {
      this.releaseAdapterAndListeners()
    }
  }

  /**
   * Disposes the adapter and every editor subscription of this owner, and drops the notices of {@link notifyValuesLoaded} that still wait for their paint allowance; {@link dispose} runs it last, also when a wait before it failed.
   * @example this.releaseAdapterAndListeners()
   */
  private releaseAdapterAndListeners(): void {
    this.adapter?.dispose()
    for (const disposable of this.disposables) disposable.dispose()
    // A disposed owner tells its reader nothing more, so no timer of it keeps the event loop alive.
    for (const timer of this.valuesLoadedTimers) clearTimeout(timer)
    this.valuesLoadedTimers.clear()
  }
}
