import type { NodeTestHistoryEntry } from './nodeTestHistorySchemas'
import type { ReplayDebugger } from './replayDebugger'
import {
  describeNodeRecordedSource,
  NODE_RECORDED_SOURCE_TEXT,
  type NodeRecordedSourceMessage,
} from './utils/describeNodeRecordedSource'
import { untilAborted } from './utils/untilAborted'

/** A recorded stop of a test replay, as {@link presentNodeHistoryMoment} presents it. */
type NodeTestHistoryStop = Extract<NodeTestHistoryEntry, { type: 'stop' }>

/** The words a server stop adds to its debugger thread, as {@link NodeRecordedSourceMessage} names them. */
type ServerStopThread = Pick<
  Extract<NodeRecordedSourceMessage, { kind: 'thread' }>,
  'server'
>

/**
 * Owns the one historical {@link ReplayDebugger} of a reader and the serialized retirement of the owners it replaced.
 *
 * The editor accepts one descriptor factory per debug type (F275), so an owner may be created only once the earlier one
 * is fully disposed. `StudyWorkspace` creates one slot per reader; the slot imports nothing from it, so its invariants
 * test without a reader.
 *
 * @example
 * ```ts
 * const slot = new ReplayDebuggerSlot(createDebugger, reportFailure, clearFailure)
 * await slot.presentFor(() => false, (debuggerView) => debuggerView.present(undefined, 'Not recorded', signal))
 * ```
 */
export class ReplayDebuggerSlot {
  private owner?: ReplayDebugger
  private retirement?: Promise<void>

  /**
   * @param create - Makes the next owner; called only when no owner exists and no retirement runs.
   * @param reportDisposalFailure - Receives a disposal failure of a retired owner; the slot never throws it.
   * @param clearDisposalFailure - Called when a later owner disposed cleanly, so an earlier failure no longer describes the debugger.
   */
  constructor(
    private readonly create: () => ReplayDebugger,
    private readonly reportDisposalFailure: (error: unknown) => void,
    private readonly clearDisposalFailure: () => void,
  ) {}

  /** The live owner, or `undefined` when none was created yet or the last one was retired. @example slot.current?.invalidate() */
  get current(): ReplayDebugger | undefined {
    return this.owner
  }

  /** Whether a retired owner is still being disposed. @example if (slot.retiring) await slot.retired() */
  get retiring(): boolean {
    return this.retirement !== undefined
  }

  /**
   * Replaces a historical debugger the learner stopped or that gave up after a bound.
   *
   * Only explicit replay/history opens and explicit Node stop selections call this, so playback never relaunches it silently.
   * It also waits for a replacement that an earlier request started: the playback controller lets an aborted load leave
   * while the editor is still stopping the old owner.
   *
   * @param signal - The waiting request's cancellation; it never cancels the shared disposal.
   * @throws The signal's reason once it aborts.
   * @example await slot.replaceUnavailable(signal)
   */
  async replaceUnavailable(signal?: AbortSignal): Promise<void> {
    const current = this.owner
    if (current && !current.available) void this.retire(current)
    await this.retired(signal)
  }

  /**
   * Disposes one historical debugger as part of the shared retirement that {@link ReplayDebuggerSlot.retired} waits for.
   *
   * The owner leaves the slot at once, so no caller presents through it again; its descriptor factory stays registered
   * until the editor has stopped its session.
   *
   * @param owner - The historical debugger to stop; a disposal failure is reported, never thrown.
   * @returns The shared retirement, settled once this owner and every earlier one is disposed.
   * @example void slot.retire(slot.current)
   */
  retire(owner: ReplayDebugger): Promise<void> {
    if (this.owner === owner) this.owner = undefined
    const earlier = this.retirement
    const retirement: Promise<void> = (async () => {
      await earlier
      try {
        await owner.dispose()
        // A later owner stopped cleanly, so an earlier failed disposal no longer describes the debugger.
        this.clearDisposalFailure()
      } catch (error) {
        // Its own key: a later values-loaded or session-ended notification clears only notification failures.
        this.reportDisposalFailure(error)
      }
    })().finally(() => {
      if (this.retirement === retirement) this.retirement = undefined
    })
    this.retirement = retirement
    return retirement
  }

  /**
   * Waits until no replaced historical debugger is still being disposed, before a caller creates the next one.
   *
   * A retirement queued while the caller waits (a close, a keep-open failure, another request's replacement) is waited for
   * too: the wait re-reads the slot after each settled retirement and ends only when none is pending.
   *
   * The editor accepts one descriptor factory per debug type, so a caller waits here, checks that it is still current,
   * and only then creates the owner synchronously through {@link ReplayDebuggerSlot.ensure}.
   *
   * @param signal - The waiting request's cancellation; it never cancels the shared disposal.
   * @throws The signal's reason once it aborts.
   * @example
   * ```ts
   * await slot.retired(signal)
   * signal.throwIfAborted()
   * slot.ensure()
   * ```
   */
  async retired(signal?: AbortSignal): Promise<void> {
    // A later retirement replaces this.retirement while we wait, so re-read it until none is pending.
    for (
      let retirement = this.retirement;
      retirement;
      retirement = this.retirement
    )
      await (signal ? untilAborted(retirement, signal) : retirement)
  }

  /**
   * Returns the live owner, creating it when there is none.
   *
   * @returns The one live historical debugger.
   * @throws When a retirement still runs: the caller skipped `await slot.retired()`, and a second owner would register the same descriptor factory (F275).
   * @example slot.ensure().invalidate()
   */
  ensure(): ReplayDebugger {
    if (this.retirement)
      throw new Error(
        'A historical debugger is still being disposed; wait for its retirement before creating the next one.',
      )
    this.owner ??= this.create()
    return this.owner
  }

  /**
   * Runs one presentation through the live owner, creating it when there is none, and lets a newer selection's supersession end it quietly.
   *
   * @param isSuperseded - Whether a newer selection took over; asked only when the presentation failed.
   * @param present - The presentation.
   * @returns The presentation's result; `undefined` when a newer selection superseded a failed presentation.
   * @throws The presentation's failure while the selection is still current, or the {@link ReplayDebuggerSlot.ensure} refusal while a retirement runs.
   * @example await slot.presentFor(() => false, (debuggerView) => debuggerView.present(undefined, 'Not recorded', signal))
   */
  async presentFor<Result>(
    isSuperseded: () => boolean,
    present: (debuggerView: ReplayDebugger) => Promise<Result>,
  ): Promise<Result | undefined> {
    try {
      // Inside the try so a superseded request whose ensure() refuses ends quietly too.
      return await present(this.ensure())
    } catch (error) {
      // A newer learner selection supersedes this moment's native presentation; only the current request reports failures.
      if (isSuperseded()) return undefined
      throw error
    }
  }
}

/** What {@link presentNodeHistoryMoment} needs from the reader's selection. */
export interface NodeHistoryMomentInput {
  /** The stop whose source verifies, or `undefined` for a moment without a recorded stop. */
  verifiedStop: NodeTestHistoryStop | undefined
  /** The recorded-source slot the stop's frames open. */
  slotUri: string
  /** The selection's request token. */
  request: number
  /** Whether the request token is still the reader's current selection; the caller's own wish is checked by the reader at its commit. */
  isRequestCurrent: (request: number) => boolean
  /** The server words of a stop's thread, or nothing for a test stop. */
  serverStopThread: (stop: NodeTestHistoryStop) => ServerStopThread | undefined
}

/** The outcome of {@link presentNodeHistoryMoment}: nothing was presented, or the flags the reader commits. */
export type NodeHistoryMomentResult =
  | { presented: false }
  | { presented: true; debugAvailable: boolean; valuesUninspected: boolean }

/**
 * Presents a test replay's moment in the replay debugger at the recorded-source slot (EN8 step 3): a verified stop's recorded frames and values on the thread `Recorded test stop <n> · <path>:<line>`, otherwise the thread "Not recorded at this moment" with no frames, which also starts the session when the replay opens on such a moment.
 *
 * Called by `StudyWorkspace` when it selects a moment. It holds no selection state: the reader runs its own currency check on the result and writes both flags in the same synchronous block.
 *
 * @param slot - The reader's historical debugger slot.
 * @param input - The stop, the slot and the reader's request-token check.
 * @returns `{ presented: false }` when a newer selection took over; otherwise the debugger availability and whether the values stayed uninspected, for the reader to commit.
 * @throws The debugger's failure for the current selection.
 * @example
 * ```ts
 * const moment = await presentNodeHistoryMoment(slot, input) // => { presented: true, debugAvailable: false, valuesUninspected: false }
 * ```
 */
export async function presentNodeHistoryMoment(
  slot: ReplayDebuggerSlot,
  input: NodeHistoryMomentInput,
): Promise<NodeHistoryMomentResult> {
  const { verifiedStop, request, isRequestCurrent } = input
  const isSuperseded = (): boolean => !isRequestCurrent(request)
  if (!verifiedStop) {
    // Only a retirement in progress is waited for; an owner the learner stopped is not replaced, so it stays stopped.
    if (slot.retiring) {
      await slot.retired()
      if (!isRequestCurrent(request)) return { presented: false }
    }
    // A debugger that has not started yet starts on the "Not recorded" thread; a running one was emptied by the selection's leave step, also when this moment is the committed one and a newer selection presented its stop meanwhile (4A, F191); one the learner stopped stays stopped.
    if (!slot.current)
      await slot.presentFor(isSuperseded, async (debuggerView) => {
        await debuggerView.present(
          undefined,
          NODE_RECORDED_SOURCE_TEXT.notRecordedThread,
          new AbortController().signal,
        )
      })
    return { presented: true, debugAvailable: false, valuesUninspected: false }
  }
  if (slot.current?.available === false || slot.retiring) {
    await slot.replaceUnavailable()
    // The reader may have closed or selected another stop meanwhile; only the current selection creates the next owner.
    if (isSuperseded()) return { presented: false }
  }
  const inspection = await slot.presentFor(isSuperseded, (debuggerView) =>
    debuggerView.present(
      verifiedStop.debuggerSnapshot,
      describeNodeRecordedSource({
        kind: 'thread',
        stop: verifiedStop.index + 1,
        path: verifiedStop.source.path,
        line: verifiedStop.frame.line,
        ...input.serverStopThread(verifiedStop),
      }),
      new AbortController().signal,
      { uri: input.slotUri, hash: verifiedStop.source.hash },
      // The stop's recorded inspections, so values outside the captured scopes stay inspectable in the native debugger.
      verifiedStop.facts,
    ),
  )
  return {
    presented: true,
    debugAvailable: true,
    valuesUninspected: inspection === 'uninspected',
  }
}
