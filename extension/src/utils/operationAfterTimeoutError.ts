/**
 * The failure of the wait for one operation's own `after` conditions that ran out of time.
 * Thrown by the run's operation wait so {@link ConfiguredBrowserRun} maps exactly this wait to `OPERATION_AFTER_NOT_MET` by type, never by reading the message text (any other timeout is an unexpected failure).
 * @example
 * throw new OperationAfterTimeoutError("Timed out waiting for the operation's after conditions: condition 1 not-visible")
 */
export class OperationAfterTimeoutError extends Error {}
