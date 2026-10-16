/**
 * The keyboard hand-over of the debugger stop the reader is showing: armed when the adapter reports a stop, done once Codebook gave the paused file the keyboard, idle again when the session goes on.
 * Keeps the rule "one hand-over per stop": a second frame of the same stop, or an invalidation that makes the editor handle the stop again, finds the stop done and does nothing. Only a resume of the session (its `continued` event or the learner's request) starts a new stop.
 * Owned by {@link StudyWorkspace}, which arms it in `noteStopOf`, disarms it in `noteSessionWentOn` and `forgetSession`, and marks it done in its active-editor listener.
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
   * Arms the hand-over for a stop the adapter reported, unless the same session's stop is already done.
   * @param sessionId - The debug session that stopped.
   * @example handOver.arm('live-next-browser')
   */
  arm(sessionId: string): void {
    // A stop already handed over stays done: an invalidation of the same stop must not hand the keyboard over again.
    if (this.state === 'done' && this.stoppedSessionId === sessionId) return
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
   * Names the session of the armed stop that still waits for its hand-over.
   * @returns The session id while a stop is armed and not handed over; `undefined` otherwise.
   * @example handOver.armedSessionId() // => 'live-next-browser' right after arm
   */
  armedSessionId(): string | undefined {
    return this.state === 'armed' ? this.stoppedSessionId : undefined
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
