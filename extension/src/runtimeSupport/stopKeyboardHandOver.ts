import { editorsPausedFrame } from './utils/editorsPausedFrame'
import {
  isEditorOfDebugSource,
  type DocumentUriParts,
} from './utils/isEditorOfDebugSource'
import { stackTraceRequestOf } from './utils/stackTraceRequestOf'
import {
  stackTraceResponseOf,
  type DebugStackFrameOfAnswer,
} from './utils/stackTraceResponseOf'

/** What the adapter's `stopped` event said of a stop, as {@link debugStopOf} reads it; every part is optional for a stop the editor handles again without such an event. */
interface StoppedThread {
  keepsFocus?: boolean
  threadId?: number
  reason?: string
}

/** What the record keeps of one session's current stop. */
interface HeldStop {
  /** `armed` while the stop waits for its hand-over, `done` once its paused file got the keyboard. */
  state: 'armed' | 'done'
  /** The stopped thread, when the adapter named it. */
  threadId: number | undefined
  /** The stop's reason, which decides whether the editor focuses a deemphasized frame ({@link editorsPausedFrame}). */
  reason: string | undefined
  /** The stopped thread's frames by index, as far as the adapter answered the editor's `stackTrace` requests. */
  frames: (DebugStackFrameOfAnswer | undefined)[]
  /** The editor's `stackTrace` requests for that thread that wait for their answer, by sequence number, with the index of the first frame each asks for. */
  requests: Map<number, number>
}

/**
 * The keyboard hand-over of every debug session's current stop: armed when the adapter reports a stop, done once Codebook gave the paused file the keyboard, idle again when the session goes on or when the editor reported a frame of it without a hand-over.
 * Keeps the rule "one hand-over per stop": a second frame of the same stop, or an invalidation that makes the editor handle the stop again, finds the stop done and does nothing. Only a resume of the session (its `continued` event or the learner's request) starts a new stop. Each session keeps its own state: a stop of another session, which the editor may read while it shows a handed-over stop (a Codebook run's stop beside the learner's own debug session), leaves that hand-over as it was (Cycle 0046 finding 605).
 * It also reads the editor's `stackTrace` requests and the adapter's answers for the stopped thread, and so knows the frame the editor focuses for the stop by its own rule ({@link pausedFrameIdOf}); a stop for which no frame qualifies is focused as a thread alone, and no frame the learner selects later is that stop's.
 * Owned by {@link StudyWorkspace}, which arms it in `noteStopOf`, feeds it every message of a followed session's tracker, disarms it in `noteSessionWentOn` and `forgetSession`, marks it done when it hands the keyboard over (`handOverStopKeyboard`) and settles it at every frame the editor reports.
 *
 * @example
 * const handOver = new StopKeyboardHandOver()
 * handOver.arm('live-next-browser', { threadId: 1, reason: 'breakpoint' })
 * handOver.markDone('live-next-browser')
 * handOver.isDoneFor('live-next-browser') // => true
 */
export class StopKeyboardHandOver {
  /** The current stop of each session; a session without an entry holds no stop. */
  private readonly stops = new Map<string, HeldStop>()

  /**
   * Arms the hand-over for a stop the adapter reported, unless the same session's stop is already done or the adapter asked the editor to keep the focus where it is.
   * At a stop with the adapter's `preserveFocusHint` neither editor focuses anything (the stop handling of their debug sessions calls `focusStackFrame` only when the hint is not set, VS Code 1.140.0 and Cursor 3.23.12), so its frame reaches the front only by the editor's pass of the focus or the learner's click in the Call Stack view, both preserving the focus, and the editor's default gives no file the keyboard there (Cycle 0046 finding 604). Such a stop leaves the record as it was.
   * @param sessionId - The debug session that stopped.
   * @param stop - What the adapter's `stopped` event said: `keepsFocus` for its `preserveFocusHint`, the stopped thread and the reason.
   * @example
   * handOver.arm('live-next-browser', { threadId: 1, reason: 'step' })
   * handOver.arm('learner-node', { keepsFocus: true }) // learner-node's stop never waits for a hand-over
   */
  arm(sessionId: string, stop: StoppedThread = {}): void {
    // A stop already handed over stays done: an invalidation of the same stop must not hand the keyboard over again. A stop the editor never focuses gets no hand-over.
    if (stop.keepsFocus || this.stops.get(sessionId)?.state === 'done') return
    this.stops.set(sessionId, {
      state: 'armed',
      threadId: stop.threadId,
      reason: stop.reason,
      frames: [],
      requests: new Map(),
    })
  }

  /**
   * Notes the editor's `stackTrace` request for the thread of a session's armed stop, so the adapter's answer can be placed; called for every message the session's tracker sees going to the adapter.
   * @param sessionId - The debug session the message goes to.
   * @param message - The message as the tracker receives it.
   * @example handOver.readEditorsMessage('learner-node', { type: 'request', seq: 7, command: 'stackTrace', arguments: { threadId: 1, startFrame: 0, levels: 1 } })
   */
  readEditorsMessage(sessionId: string, message: unknown): void {
    const request = stackTraceRequestOf(message)
    const held = this.stops.get(sessionId)
    // Only the stack of the thread that stopped tells which frame the editor focuses for the stop.
    if (
      request === undefined ||
      held?.state !== 'armed' ||
      (held.threadId !== undefined && held.threadId !== request.threadId)
    )
      return
    held.requests.set(request.seq, request.startFrame)
  }

  /**
   * Places the adapter's answer to a noted `stackTrace` request among the frames of the session's armed stop; called for every message the session's tracker sees coming from the adapter.
   * @param sessionId - The debug session the message comes from.
   * @param message - The message as the tracker receives it.
   * @example handOver.readAdaptersMessage('learner-node', { type: 'response', request_seq: 7, success: true, command: 'stackTrace', body: { stackFrames: [{ id: 1000, source: { path: '/app/actions.ts' } }] } })
   */
  readAdaptersMessage(sessionId: string, message: unknown): void {
    const response = stackTraceResponseOf(message)
    const held = this.stops.get(sessionId)
    const startFrame = response && held?.requests.get(response.requestSeq)
    if (
      response === undefined ||
      held === undefined ||
      startFrame === undefined
    )
      return
    held.requests.delete(response.requestSeq)
    // An answer that starts further down the stack keeps the frames above it in their places.
    for (const [index, frame] of response.frames.entries())
      held.frames[startFrame + index] = frame
  }

  /**
   * Names the frame the editor focuses for a session's armed stop by its own rule, from the frames the adapter answered so far ({@link editorsPausedFrame}).
   * @param sessionId - The debug session of the stop.
   * @returns The frame's id; `undefined` while no frame qualifies (the editor focuses the thread alone) and for a session whose stop does not wait for its hand-over.
   * @example handOver.pausedFrameIdOf('learner-node') // => 1000 once the adapter answered the stopped thread's top frame
   */
  pausedFrameIdOf(sessionId: string): number | undefined {
    const held = this.stops.get(sessionId)
    return held?.state === 'armed'
      ? editorsPausedFrame(held.frames, held.reason)?.id
      : undefined
  }

  /**
   * Names the armed stop whose paused file a text editor that became active shows: the source of the frame the editor focuses for that stop ({@link editorsPausedFrame}), mapped as the editor maps a source to a document ({@link isEditorOfDebugSource}). Asked when a text editor becomes active, which for a stop the editor's own handling brings is the paused file's opening, 4 to 105 ms before the stop's frame (Cycle 0046, C50 to C55).
   * @param editor - The text editor that became active, if any.
   * @param platform - The operating system, which decides whether a file's case counts.
   * @returns The stop's session with that editor; `undefined` without an editor and when no armed stop's paused file is that document.
   * @example handOver.armedStopOpenedIn(actionsEditor) // => { sessionId: 'learner-node', editor: actionsEditor } once the adapter answered learner-node's top frame in actions.ts
   */
  armedStopOpenedIn<Editor extends { document: { uri: DocumentUriParts } }>(
    editor: Editor | undefined,
    platform: NodeJS.Platform = process.platform,
  ): { sessionId: string; editor: Editor } | undefined {
    if (editor === undefined) return undefined
    for (const [sessionId, held] of this.stops) {
      const source =
        held.state === 'armed'
          ? editorsPausedFrame(held.frames, held.reason)?.source
          : undefined
      // The first armed stop whose paused file the editor shows is the stop that opened it.
      if (
        source !== undefined &&
        isEditorOfDebugSource(editor.document.uri, source, sessionId, platform)
      )
        return { sessionId, editor }
    }
    return undefined
  }

  /**
   * Ends the stop of a session that went on or ended, so its next stop starts a new hand-over; the stops of other sessions stay as they are.
   * @param sessionId - The debug session that continued, stepped or ended.
   * @example handOver.disarm('live-next-browser')
   */
  disarm(sessionId: string): void {
    this.stops.delete(sessionId)
  }

  /**
   * Settles the stop of a session whose frame the editor reported: a stop that still waits gets no hand-over any more, since the editor reports its stop's frame after it opened the paused file, and nothing later in that pause is the paused file (Cycle 0046 finding 603); a handed-over stop stays done.
   * @param sessionId - The session of the frame the editor reported; `undefined` (a thread, no item, or a session that holds no stop) settles nothing.
   * @example handOver.settle('learner-node')
   */
  settle(sessionId: string | undefined): void {
    if (sessionId !== undefined && this.isArmedFor(sessionId))
      this.stops.delete(sessionId)
  }

  /**
   * Marks a session's armed stop as handed over; a stop that is not armed stays as it is.
   * @param sessionId - The debug session whose paused file got the keyboard.
   * @example handOver.markDone('live-next-browser')
   */
  markDone(sessionId: string): void {
    const held = this.stops.get(sessionId)
    if (held?.state === 'armed') held.state = 'done'
  }

  /**
   * Says whether a session's stop still waits for its hand-over, which the editor's report of that stop's frame resolves.
   * @param sessionId - The debug session of the frame the editor reports.
   * @returns `true` only while that session's stop is armed and not handed over.
   * @example handOver.isArmedFor('live-next-browser') // => true right after arm('live-next-browser')
   */
  isArmedFor(sessionId: string): boolean {
    return this.stops.get(sessionId)?.state === 'armed'
  }

  /**
   * Says whether a session holds a stop: armed (waiting for its hand-over) or done (handed over).
   * @param sessionId - The debug session of the frame the editor reports.
   * @returns `true` while that session's stop is armed or done; `false` once it went on, ended, was settled or never stopped.
   * @example handOver.isHeldFor('live-next-browser') // => true after markDone('live-next-browser')
   */
  isHeldFor(sessionId: string): boolean {
    return this.stops.has(sessionId)
  }

  /**
   * Says whether the keyboard was handed over for a session's current stop.
   * @param sessionId - The debug session of the frame the editor shows.
   * @returns `true` only when that session's stop is done.
   * @example handOver.isDoneFor('live-next-browser') // => true after markDone('live-next-browser')
   */
  isDoneFor(sessionId: string): boolean {
    return this.stops.get(sessionId)?.state === 'done'
  }
}
