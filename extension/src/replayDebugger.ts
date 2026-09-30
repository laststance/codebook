import { randomUUID } from 'node:crypto'

import type * as vscode from 'vscode'

import {
  REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  REPLAY_DEBUG_INSPECTION_GRACE_MS,
  REPLAY_DEBUG_SESSION_NAME,
  REPLAY_DEBUG_TYPE,
} from './constants'
import {
  ReplayDebugAdapter,
  type ReplaySourceDocument,
} from './replayDebugAdapter'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import { waitUntil } from './runtimeSupport/utils/waitUntil'

const HISTORICAL_DEBUGGER_CLOSED =
  'Historical debugger closed. Reopen the learning replay to restore it.'
const HISTORICAL_PRESENTATION_SUPERSEDED =
  'Historical debugger presentation was superseded.'

/** Whether native Run and Debug loaded a presented moment's recorded values before the moment committed. */
export type ReplayInspection = 'inspected' | 'uninspected'

/** Owns the selected native historical session for {@link StudyWorkspace}; never adopts or stops another debugger. @example await debuggerView.present(snapshot, 'Recorded · 00:42', signal) */
export class ReplayDebugger {
  private readonly token = randomUUID()
  private readonly disposables: vscode.Disposable[] = []
  private session?: vscode.DebugSession
  private adapter?: ReplayDebugAdapter
  private starting?: Promise<void>
  private retiring?: Promise<void>
  private retiringSessionId?: string
  private closed = false
  private detached = false
  private revision = 0
  private selected?: {
    snapshot: ReplayDebugSnapshot | undefined
    label: string
    sourceUri?: string
  }
  private hasPresented = false
  private lastPresentedSnapshot?: ReplayDebugSnapshot
  /** The last committed moment's values were not loaded and native Run and Debug has requested none since. */
  private valuesUnrequested = false

  /**
   * Registers the owned historical debug adapter for {@link StudyWorkspace}.
   * @param editor - VS Code API surface used to start, observe and stop the owned session.
   * @param changed - Runs when native Run and Debug loads the selected stop's values or the learner ends the owned session, so the reader can drop a stale hint.
   * @example new ReplayDebugger(vscode, () => this.replayDebuggerChanged())
   */
  constructor(
    private readonly editor: Pick<
      typeof vscode,
      'EventEmitter' | 'DebugAdapterInlineImplementation'
    > & {
      debug: Pick<
        typeof vscode.debug,
        | 'registerDebugAdapterDescriptorFactory'
        | 'onDidTerminateDebugSession'
        | 'startDebugging'
        | 'stopDebugging'
      >
    },
    private readonly changed: () => void = () => {},
  ) {
    this.disposables.push(
      this.editor.debug.registerDebugAdapterDescriptorFactory(
        REPLAY_DEBUG_TYPE,
        {
          createDebugAdapterDescriptor: (session) => {
            // A learner-stopped owner stays detached: an editor relaunch would otherwise be adopted without history.
            if (
              this.closed ||
              this.detached ||
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
                (message) => events.fire(message),
                () => {
                  this.detached = true
                },
                () => {
                  // Values now load, so later stops wait for them again and the reader drops its hint.
                  if (this.adapter !== adapter) return
                  this.valuesUnrequested = false
                  this.changed()
                },
              ))
            return new this.editor.DebugAdapterInlineImplementation({
              onDidSendMessage: events.event,
              handleMessage: (message) => adapter.handleMessage(message),
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
        if (session.id !== this.session?.id) return
        // A replacement adapter starts empty, so the next presentation must select its stop again.
        this.adapter?.dispose()
        this.adapter = undefined
        this.session = undefined
        this.detached = true
        this.selected = undefined
        // Codebook retiring its own session to change stops keeps the learner's Run and Debug layout, so values stay unrequested and the hint stays.
        if (session.id === this.retiringSessionId) {
          this.detached = false
          this.starting = undefined
          return
        }
        this.valuesUnrequested = false
        this.changed()
      }),
    )
  }

  /** Reports whether playback may still present history; false after the learner stops the owned session, so an explicit replay reopen replaces this owner. @example if (!debuggerView.available) await debuggerView.dispose() */
  get available(): boolean {
    return !this.closed && !this.detached
  }

  /** Clears native state immediately when a pending seek retires the displayed bundle. @example debuggerView.invalidate() */
  invalidate(): void {
    this.revision++
    this.selected = undefined
    this.adapter?.select(undefined, 'Not recorded at this moment')
  }

  /** Retires only a different historical stop; video frames within one stop keep their native context. @example await debuggerView.retire(snapshot, signal) */
  async retire(
    snapshot: ReplayDebugSnapshot | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    if (this.closed || this.detached)
      throw new Error(HISTORICAL_DEBUGGER_CLOSED)
    if (this.hasPresented && this.lastPresentedSnapshot === snapshot) return
    this.retiring ??= (async () => {
      await this.starting?.catch(() => {})
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
        this.retiringSessionId = undefined
      }
    })().finally(() => {
      this.retiring = undefined
    })
    await this.retiring
    signal.throwIfAborted()
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
   * @returns `'inspected'` when current stack, scopes and first values were retrieved; `'uninspected'` when the grace elapsed first.
   * @throws When the learner stopped the owned session, the workspace closed, a newer presentation superseded this one or `signal` aborted.
   * @example
   * await debuggerView.present(snapshot, 'Recorded pause · 55.87 s', signal) // => 'inspected'
   */
  async present(
    snapshot: ReplayDebugSnapshot | undefined,
    label: string,
    signal: AbortSignal,
    sourceDocument?: ReplaySourceDocument,
  ): Promise<ReplayInspection> {
    signal.throwIfAborted()
    if (this.closed || this.detached)
      throw new Error(HISTORICAL_DEBUGGER_CLOSED)
    const revision = ++this.revision
    await this.retiring
    const starting = (this.starting ??= (async () => {
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
      if (!started || !this.session || !this.adapter)
        throw new Error(
          'The editor did not start its historical debug session.',
        )
      if (this.closed)
        throw new Error('Historical debugger closed during startup.')
    })())
    // A refused startup must not poison later presentations; the next one retries it.
    try {
      await starting
    } catch (error) {
      if (this.starting === starting && !this.session) this.starting = undefined
      throw error
    }
    signal.throwIfAborted()
    if (this.closed || this.detached || revision !== this.revision)
      throw new Error(HISTORICAL_PRESENTATION_SUPERSEDED)
    const adapter = this.adapter!
    // A duplicate selection may share pending inspection, but cannot bypass its readiness boundary.
    if (
      !this.selected ||
      this.selected.snapshot !== snapshot ||
      this.selected.label !== label ||
      this.selected.sourceUri !== sourceDocument?.uri
    ) {
      adapter.select(snapshot, label, sourceDocument)
      this.selected = { snapshot, label, sourceUri: sourceDocument?.uri }
    }
    // The native session shows this stop from now on, so an interrupted wait cannot make retire() restart it.
    this.hasPresented = true
    this.lastPresentedSnapshot = snapshot
    // While Run and Debug requests no values, waiting on every stop would stall playback without ever loading them.
    const inspection =
      this.valuesUnrequested && !adapter.inspectionReady
        ? 'uninspected'
        : await this.awaitInspection(adapter, revision, signal)
    signal.throwIfAborted()
    // Only a loaded Variables page (the adapter's report) clears this; a gap or scope-less stop proves nothing about Variables.
    if (inspection === 'uninspected') this.valuesUnrequested = true
    return inspection
  }

  /**
   * Waits up to {@link REPLAY_DEBUG_INSPECTION_GRACE_MS} for {@link ReplayDebugAdapter.inspectionReady} on behalf of {@link present}.
   * @param adapter - Adapter that received the current selection.
   * @param revision - Presentation revision that owns this wait.
   * @param signal - Caller cancellation.
   * @returns `'inspected'` when retrieval completed, otherwise `'uninspected'` once the grace elapsed.
   * @throws When the session closed, a newer presentation superseded this one or `signal` aborted.
   * @example await this.awaitInspection(adapter, revision, signal) // => 'uninspected' while Variables is hidden
   */
  private async awaitInspection(
    adapter: ReplayDebugAdapter,
    revision: number,
    signal: AbortSignal,
  ): Promise<ReplayInspection> {
    const assertCurrent = (): void => {
      if (this.closed || this.detached || this.adapter !== adapter)
        throw new Error(HISTORICAL_DEBUGGER_CLOSED)
      if (revision !== this.revision)
        throw new Error(HISTORICAL_PRESENTATION_SUPERSEDED)
    }
    try {
      await waitUntil(
        () => {
          assertCurrent()
          return adapter.inspectionReady
        },
        'native Run and Debug to load the recorded values',
        REPLAY_DEBUG_INSPECTION_GRACE_MS,
        signal,
      )
      return 'inspected'
    } catch {
      // Only the grace deadline leaves a current, unaborted selection; closure, supersession and abort keep their own errors.
      signal.throwIfAborted()
      assertCurrent()
      // Values that loaded during the last poll interval already notified the reader, which must not get a stale hint afterwards.
      return adapter.inspectionReady ? 'inspected' : 'uninspected'
    }
  }

  /** Stops only its exact owned session, including a startup that completes after workspace closure. @example await debuggerView.dispose() */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.invalidate()
    try {
      await this.retiring?.catch(() => {})
      await this.starting?.catch(() => {})
      if (this.session) await this.editor.debug.stopDebugging(this.session)
    } finally {
      this.adapter?.dispose()
      for (const disposable of this.disposables) disposable.dispose()
    }
  }
}
