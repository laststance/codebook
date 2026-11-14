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
  /** The stopped thread's frames, as far as the adapter answered the editor's `stackTrace` requests. */
  frames: StoppedThreadFrames
}

/**
 * The frames of one stopped thread, as far as the adapter answered the editor's `stackTrace` requests for that thread; {@link StopKeyboardHandOver} keeps one for each held stop and one for each session's latest stop.
 * @example
 * const frames = new StoppedThreadFrames(1, 'breakpoint')
 * frames.noteRequest({ seq: 7, threadId: 1, startFrame: 0 })
 * frames.placeAnswer({ requestSeq: 7, frames: [{ id: 1000, source: { path: '/app/actions.ts' } }] })
 * frames.pausedFrame() // => { id: 1000, source: { path: '/app/actions.ts' } }
 */
class StoppedThreadFrames {
  /** The stopped thread's frames by index; a hole is a frame not answered yet. */
  private readonly frames: (DebugStackFrameOfAnswer | undefined)[] = []
  /** The editor's `stackTrace` requests for that thread that wait for their answer, by sequence number, with the index of the first frame each asks for. */
  private readonly requests = new Map<number, number>()

  /**
   * @param threadId - The stopped thread, when the adapter named it.
   * @param reason - The stop's reason, which decides whether the editor focuses a deemphasized frame ({@link editorsPausedFrame}).
   */
  constructor(
    private readonly threadId: number | undefined,
    private readonly reason: string | undefined,
  ) {}

  /**
   * Notes the editor's `stackTrace` request for this thread, so the adapter's answer can be placed; a request for another thread is left alone.
   * @param request - The request as {@link stackTraceRequestOf} reads it.
   * @example frames.noteRequest({ seq: 7, threadId: 1, startFrame: 0 })
   */
  noteRequest(
    request: NonNullable<ReturnType<typeof stackTraceRequestOf>>,
  ): void {
    // Only the stack of the thread that stopped tells which frame the editor focuses for the stop.
    if (this.threadId !== undefined && this.threadId !== request.threadId)
      return
    this.requests.set(request.seq, request.startFrame)
  }

  /**
   * Places the adapter's answer to a noted request among the frames; an answer to another request is left alone.
   * @param response - The answer as {@link stackTraceResponseOf} reads it.
   * @example frames.placeAnswer({ requestSeq: 7, frames: [{ id: 1000, source: { path: '/app/actions.ts' } }] })
   */
  placeAnswer(
    response: NonNullable<ReturnType<typeof stackTraceResponseOf>>,
  ): void {
    const startFrame = this.requests.get(response.requestSeq)
    if (startFrame === undefined) return
    this.requests.delete(response.requestSeq)
    // An answer that starts further down the stack keeps the frames above it in their places.
    for (const [index, frame] of response.frames.entries())
      this.frames[startFrame + index] = frame
  }

  /**
   * Names the frame the editor focuses for the stop by its own rule, from the frames answered so far ({@link editorsPausedFrame}).
   * @returns The frame; `undefined` while no frame qualifies.
   * @example frames.pausedFrame()?.source // => { path: '/app/actions.ts' }
   */
  pausedFrame(): DebugStackFrameOfAnswer | undefined {
    return editorsPausedFrame(this.frames, this.reason)
  }
}

/**
 * The keyboard hand-over of every debug session's current stop: armed when the adapter reports a stop, done once Codebook gave the paused file the keyboard, idle again when the session goes on or when the editor reported a frame of it without a hand-over.
 * Keeps the rule "one hand-over per stop": a second frame of the same stop, or an invalidation that makes the editor handle the stop again, finds the stop done and does nothing. Only a resume of the session (its `continued` event or the learner's request) starts a new stop. Each session keeps its own state: a stop of another session, which the editor may read while it shows a handed-over stop (a Codebook run's stop beside the learner's own debug session), leaves that hand-over as it was (Cycle 0046 finding 605).
 * It also reads the editor's `stackTrace` requests and the adapter's answers for the stopped thread, and so knows the frame the editor focuses for the stop by its own rule ({@link pausedFrameIdOf}); a stop for which no frame qualifies is focused as a thread alone, and no frame the learner selects later is that stop's. It reads the same of each session's latest stop, also one that waits for no hand-over, for the paused file the stop note of the kept Application asks for ({@link showsPausedFileOf}).
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
  /** The frames of each session's latest stop, also one that waits for no hand-over, until the session goes on or ends ({@link disarm}); read by {@link showsPausedFileOf}. */
  private readonly latestStops = new Map<string, StoppedThreadFrames>()

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
    // Every stop's frames are read for the stop note of the kept Application, also those of a stop that gets no hand-over.
    this.latestStops.set(
      sessionId,
      new StoppedThreadFrames(stop.threadId, stop.reason),
    )
    // A stop already handed over stays done: an invalidation of the same stop must not hand the keyboard over again. A stop the editor never focuses gets no hand-over.
    if (stop.keepsFocus || this.stops.get(sessionId)?.state === 'done') return
    this.stops.set(sessionId, {
      state: 'armed',
      frames: new StoppedThreadFrames(stop.threadId, stop.reason),
    })
  }

  /**
   * Notes the editor's `stackTrace` request for the thread of a session's armed stop and of its latest stop, so the adapter's answer can be placed; called for every message the session's tracker sees going to the adapter.
   * @param sessionId - The debug session the message goes to.
   * @param message - The message as the tracker receives it.
   * @example handOver.readEditorsMessage('learner-node', { type: 'request', seq: 7, command: 'stackTrace', arguments: { threadId: 1, startFrame: 0, levels: 1 } })
   */
  readEditorsMessage(sessionId: string, message: unknown): void {
    const request = stackTraceRequestOf(message)
    if (request === undefined) return
    const held = this.stops.get(sessionId)
    // A handed-over stop needs no more frames; the latest stop's are read for the stop note.
    if (held?.state === 'armed') held.frames.noteRequest(request)
    this.latestStops.get(sessionId)?.noteRequest(request)
  }

  /**
   * Places the adapter's answer to a noted `stackTrace` request among the frames of the session's held stop and of its latest stop; called for every message the session's tracker sees coming from the adapter.
   * @param sessionId - The debug session the message comes from.
   * @param message - The message as the tracker receives it.
   * @example handOver.readAdaptersMessage('learner-node', { type: 'response', request_seq: 7, success: true, command: 'stackTrace', body: { stackFrames: [{ id: 1000, source: { path: '/app/actions.ts' } }] } })
   */
  readAdaptersMessage(sessionId: string, message: unknown): void {
    const response = stackTraceResponseOf(message)
    if (response === undefined) return
    this.stops.get(sessionId)?.frames.placeAnswer(response)
    this.latestStops.get(sessionId)?.placeAnswer(response)
  }

  /**
   * Names the frame the editor focuses for a session's armed stop by its own rule, from the frames the adapter answered so far ({@link editorsPausedFrame}).
   * @param sessionId - The debug session of the stop.
   * @returns The frame's id; `undefined` while no frame qualifies (the editor focuses the thread alone) and for a session whose stop does not wait for its hand-over.
   * @example handOver.pausedFrameIdOf('learner-node') // => 1000 once the adapter answered the stopped thread's top frame
   */
  pausedFrameIdOf(sessionId: string): number | undefined {
    const held = this.stops.get(sessionId)
    return held?.state === 'armed' ? held.frames.pausedFrame()?.id : undefined
  }

  /**
   * Says whether a document is the paused file of a session's latest stop: the source of the frame the editor focuses for it by its own rule ({@link editorsPausedFrame}), mapped as the editor maps a source to a document ({@link isEditorOfDebugSource}). Asked by the stop note of {@link StudyWorkspace} when the editor reports a frame, for every stop, also one that waits for no hand-over, so a file the learner brought in front meanwhile is never taken for the stop's.
   * @param sessionId - The debug session of the stop.
   * @param uri - The document of a tab.
   * @param platform - The operating system, which decides whether a file's case counts.
   * @returns `true` once the adapter answered the stopped thread's frames and the editor's paused frame lies in that document; `false` before that, for another document, and for a session that went on, ended or never stopped.
   * @example handOver.showsPausedFileOf('library-tests', settingsTestUri) // => true once the adapter answered the stop's top frame in settings.test.js
   */
  showsPausedFileOf(
    sessionId: string,
    uri: DocumentUriParts,
    platform: NodeJS.Platform = process.platform,
  ): boolean {
    const source = this.latestStops.get(sessionId)?.pausedFrame()?.source
    return (
      source !== undefined &&
      isEditorOfDebugSource(uri, source, sessionId, platform)
    )
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
        held.state === 'armed' ? held.frames.pausedFrame()?.source : undefined
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
   * Ends the stop of a session that went on or ended, with its latest stop's frames, so its next stop starts a new hand-over; the stops of other sessions stay as they are.
   * @param sessionId - The debug session that continued, stepped or ended.
   * @example handOver.disarm('live-next-browser')
   */
  disarm(sessionId: string): void {
    this.stops.delete(sessionId)
    this.latestStops.delete(sessionId)
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
