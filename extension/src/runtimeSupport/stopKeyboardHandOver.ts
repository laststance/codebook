/**
 * The keyboard hand-over of every debug session's current stop: armed when the adapter reports a stop, done once Codebook gave the paused file the keyboard, idle again when the session goes on.
 * Keeps the rule "one hand-over per stop": a second frame of the same stop, or an invalidation that makes the editor handle the stop again, finds the stop done and does nothing. Only a resume of the session (its `continued` event or the learner's request) starts a new stop. Each session keeps its own state: a stop of another session, which the editor may read while it shows a handed-over stop (a Codebook run's stop beside the learner's own debug session), leaves that hand-over as it was (Cycle 0046 finding 605).
 * Owned by {@link StudyWorkspace}, which arms it in `noteStopOf`, disarms it in `noteSessionWentOn` and `forgetSession`, and marks it done when the editor reports the stop's frame (`handOverStopKeyboard`).
 *
 * @example
 * const handOver = new StopKeyboardHandOver()
 * handOver.arm('live-next-browser')
 * handOver.markDone('live-next-browser')
 * handOver.isDoneFor('live-next-browser') // => true
 */
export class StopKeyboardHandOver {
  /** The state of each session's current stop; a session without an entry holds no stop. */
  private readonly stops = new Map<string, 'armed' | 'done'>()

  /**
   * Arms the hand-over for a stop the adapter reported, unless the same session's stop is already done or the adapter asked the editor to keep the focus where it is.
   * At a stop with the adapter's `preserveFocusHint` neither editor focuses anything (the stop handling of their debug sessions calls `focusStackFrame` only when the hint is not set, VS Code 1.140.0 and Cursor 3.23.12), so its frame reaches the front only by the editor's pass of the focus or the learner's click in the Call Stack view, both preserving the focus, and the editor's default gives no file the keyboard there (Cycle 0046 finding 604). Such a stop leaves the record as it was.
   * @param sessionId - The debug session that stopped.
   * @param asksToKeepFocus - Whether the adapter's `stopped` event set `preserveFocusHint`.
   * @example
   * handOver.arm('live-next-browser')
   * handOver.arm('learner-node', true) // learner-node's stop never waits for a hand-over
   */
  arm(sessionId: string, asksToKeepFocus = false): void {
    // A stop already handed over stays done: an invalidation of the same stop must not hand the keyboard over again. A stop the editor never focuses gets no hand-over.
    if (asksToKeepFocus || this.stops.get(sessionId) === 'done') return
    this.stops.set(sessionId, 'armed')
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
   * Marks a session's armed stop as handed over; a stop that is not armed stays as it is.
   * @param sessionId - The debug session whose paused file got the keyboard.
   * @example handOver.markDone('live-next-browser')
   */
  markDone(sessionId: string): void {
    if (this.stops.get(sessionId) === 'armed') this.stops.set(sessionId, 'done')
  }

  /**
   * Says whether a session's stop still waits for its hand-over, which the editor's report of that stop's frame resolves.
   * @param sessionId - The debug session of the frame the editor reports.
   * @returns `true` only while that session's stop is armed and not handed over.
   * @example handOver.isArmedFor('live-next-browser') // => true right after arm('live-next-browser')
   */
  isArmedFor(sessionId: string): boolean {
    return this.stops.get(sessionId) === 'armed'
  }

  /**
   * Says whether a session holds a stop: armed (waiting for its hand-over) or done (handed over).
   * @param sessionId - The debug session of the frame the editor reports.
   * @returns `true` while that session's stop is armed or done; `false` once it went on, ended or never stopped.
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
    return this.stops.get(sessionId) === 'done'
  }
}
