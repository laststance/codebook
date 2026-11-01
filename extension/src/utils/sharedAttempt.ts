/**
 * Shares one in-flight attempt of a repeatable operation among its callers and forgets it once it fails, so the next call tries again.
 * Exists for releases and cleanups that several endings may request at once and that must stay retryable after a failure; used by the chrome-extension and node-server debuggers' releases and by the release of a saved session's run and setup leases ({@link SavedSessionStore}).
 * @example
 * const release = new SharedAttempt(() => removeEverything())
 * await Promise.all([release.run(), release.run()]) // removeEverything runs once
 */
export class SharedAttempt {
  private current?: Promise<void>

  /** @param operation - Starts one attempt; called again only after the previous attempt failed. */
  constructor(private readonly operation: () => Promise<void>) {}

  /**
   * Joins the attempt in flight or the one that succeeded, or starts a new one.
   * @returns The attempt's outcome.
   * @throws The attempt's error; that attempt is dropped, so the next call runs the operation again.
   */
  run(): Promise<void> {
    const attempt = (this.current ??= this.operation())
    return attempt.catch((error: unknown) => {
      // A failed attempt is dropped, so the next call runs the operation again.
      if (this.current === attempt) this.current = undefined
      throw error
    })
  }
}
