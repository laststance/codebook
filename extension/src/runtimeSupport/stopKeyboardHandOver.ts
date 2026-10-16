/**
 * The keyboard hand-over of the debugger stop the reader is showing: armed when the adapter reports a stop, done once Codebook gave the paused file the keyboard, idle again when the session goes on.
 * Keeps the rule "one hand-over per stop": a second frame of the same stop, or an invalidation that makes the editor handle the stop again, finds the stop done and does nothing. Only a resume of the session (its `continued` event or the learner's request) starts a new stop.
 * Owned by {@link StudyWorkspace}, which arms it in `noteStopOf`, disarms it in `noteSessionWentOn` and `forgetSession`, and marks it done when the editor reports the stop's frame (`handOverStopKeyboard`).
 *
 * @example
 * const handOver = new StopKeyboardHandOver()
 * handOver.arm('live-next-browser')
 * handOver.markDone()
 * handOver.isDoneFor('live-next-browser') // => true
 */
export class StopKeyboardHandOver {
  private state: 'idle' | 'armed' | 'done' = 'idle'
  private stoppedSessionId: string | undefined

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
    if (
      asksToKeepFocus ||
      (this.state === 'done' && this.stoppedSessionId === sessionId)
    )
      return
    this.state = 'armed'
    this.stoppedSessionId = sessionId
  }

  /**
   * Ends the stop of a session that went on, so its next stop starts a new hand-over.
   * @param sessionId - The debug session that continued, stepped or ended.
   * @example handOver.disarm('live-next-browser')
   */
  disarm(sessionId: string): void {
    if (this.stoppedSessionId !== sessionId) return
    this.state = 'idle'
    this.stoppedSessionId = undefined
  }

  /**
   * Marks the armed stop as handed over; a stop that is not armed stays as it is.
   * @example handOver.markDone()
   */
  markDone(): void {
    if (this.state === 'armed') this.state = 'done'
  }

  /**
   * Says whether a session's stop still waits for its hand-over, which the editor's report of that stop's frame resolves.
   * @param sessionId - The debug session of the frame the editor reports.
   * @returns `true` only while that session's stop is armed and not handed over.
   * @example handOver.isArmedFor('live-next-browser') // => true right after arm('live-next-browser')
   */
  isArmedFor(sessionId: string): boolean {
    return this.state === 'armed' && this.stoppedSessionId === sessionId
  }

  /**
   * Names the session of the stop that is held: armed (waiting for its hand-over) or done (handed over).
   * @returns The session id while the stop is armed or done; `undefined` while idle.
   * @example handOver.heldSessionId() // => 'live-next-browser' after markDone
   */
  heldSessionId(): string | undefined {
    return this.state === 'idle' ? undefined : this.stoppedSessionId
  }

  /**
   * Says whether the keyboard was handed over for a session's current stop.
   * @param sessionId - The debug session of the frame the editor shows.
   * @returns `true` only when that session's stop is done.
   * @example handOver.isDoneFor('live-next-browser') // => true after markDone
   */
  isDoneFor(sessionId: string): boolean {
    return this.state === 'done' && this.stoppedSessionId === sessionId
  }
}
