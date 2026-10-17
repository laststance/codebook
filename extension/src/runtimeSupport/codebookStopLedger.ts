/**
 * Records which debugger stops a live Codebook run or an owned Node test run caused, for the reader that decides who gets the keyboard at a stop.
 * The configured run and the owned Node test run write it while they read the adapter's messages; {@link StudyWorkspace} reads it when the editor shows the stop. The causal window of a session is open while the run has an input, a continuation or its own resume in flight for the stop that session reports next; the run closes it when it accepts that stop, and a learner's resume or pause, the run's failure and its cleanup close it too, so a stop the learner starts is not Codebook's.
 * Module-level on purpose: the run, the Node test run and every reader of the same editor window share one ledger, and {@link codebookStopLedger} is the only instance.
 *
 * @example
 * codebookStopLedger.openWindow(['live-next-browser'])
 * codebookStopLedger.recordStop('live-next-browser', true)
 * codebookStopLedger.isCodebookCausedStop('live-next-browser') // => true
 */
export class CodebookStopLedger {
  /** Sessions whose next reported stop is inside a causal window and has no verdict yet. */
  private readonly openWindows = new Set<string>()
  /** The verdict of each session's latest stop: `true` when Codebook caused it, kept until that session's next stop or {@link forget}. */
  private readonly causedStops = new Map<string, boolean>()
  /** Sessions of owned Node test runs, whose every stop belongs to the run. */
  private readonly ownedSessions = new Set<string>()

  /**
   * Opens the causal window of the sessions whose next stop the run expects; called when an input is accepted, when a continuation starts and when the run resumes a page pause itself.
   * @param sessionIds - The debug sessions of the stop(s) the run expects next.
   * @example codebookStopLedger.openWindow(['live-next-browser'])
   */
  openWindow(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) this.openWindows.add(sessionId)
  }

  /**
   * Closes the causal window of sessions: when the run accepts the stop it expected, and when a learner's step, continue or pause request or the run's failure ends the window.
   * @param sessionIds - The debug sessions whose window ends.
   * @example codebookStopLedger.closeWindow(['live-next-browser'])
   */
  closeWindow(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) this.openWindows.delete(sessionId)
  }

  /**
   * Says whether a session's causal window is open, so a stop it reports now is Codebook's unless it is an adapter refresh.
   * @param sessionId - The debug session of the stop.
   * @returns `true` while the window is open: opened and not yet closed by an accepted stop, a learner's request, a failure or cleanup.
   * @example codebookStopLedger.isWindowOpen('live-next-browser') // => true after openWindow
   */
  isWindowOpen(sessionId: string): boolean {
    return this.openWindows.has(sessionId)
  }

  /**
   * Records the verdict of a stop the run read; the window stays open until the run accepts the stop ({@link closeWindow}), because the run reads a stop that arrived during its continuation a second time once that continuation completes.
   * @param sessionId - The debug session that stopped.
   * @param caused - Whether Codebook caused the stop ({@link isStopCausedByCodebook}).
   * @example codebookStopLedger.recordStop('live-next-browser', false) // an adapter refresh
   */
  recordStop(sessionId: string, caused: boolean): void {
    this.causedStops.set(sessionId, caused)
  }

  /**
   * Marks every stop of a session as Codebook's, for an owned Node test run's debug session.
   * @param sessionId - The debug session the owned Node test run started.
   * @example codebookStopLedger.ownSession('node-test-session')
   */
  ownSession(sessionId: string): void {
    this.ownedSessions.add(sessionId)
  }

  /**
   * Says whether the stop a session reported last belongs to Codebook, asked by {@link StudyWorkspace} when the editor shows that stop's file.
   * @param sessionId - The debug session of the stop.
   * @returns `true` for an owned Node test session, and for a session whose latest stop the run recorded as caused; `false` for any other session, including every session of a debugger the learner started.
   * @example codebookStopLedger.isCodebookCausedStop('learner-own-session') // => false
   */
  isCodebookCausedStop(sessionId: string): boolean {
    return (
      this.ownedSessions.has(sessionId) ||
      this.causedStops.get(sessionId) === true
    )
  }

  /**
   * Drops everything the ledger keeps for a debug session that ended, called when the session terminates or its run cleans up.
   * @param sessionId - The debug session that ended.
   * @example codebookStopLedger.forget('live-next-browser')
   */
  forget(sessionId: string): void {
    this.openWindows.delete(sessionId)
    this.causedStops.delete(sessionId)
    this.ownedSessions.delete(sessionId)
  }

  /**
   * Empties the ledger; the test harness calls it before each reader test so no verdict leaks between tests.
   * @example codebookStopLedger.reset()
   */
  reset(): void {
    this.openWindows.clear()
    this.causedStops.clear()
    this.ownedSessions.clear()
  }
}

/** The one ledger of the editor window, shared by the configured run, the owned Node test run and the reader. */
export const codebookStopLedger = new CodebookStopLedger()
