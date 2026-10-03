/**
 * Refuses a process group id that would not name one owned, detached group before a signal is sent to its negation.
 *
 * `process.kill(-0, …)` signals the caller's own group and `process.kill(-1, …)` every process the user may signal, so an id of 0 or 1 (or one that
 * is not a positive integer) must never reach `process.kill`. Called by {@link signalProcessGroup} and {@link isProcessGroupGone}.
 *
 * @param processGroup - Process group id, the pid of the detached group leader.
 * @throws A `RangeError` naming the id when it is not an integer greater than 1.
 * @example
 * assertOwnedProcessGroup(4242) // passes
 * assertOwnedProcessGroup(1)    // throws RangeError
 */
export function assertOwnedProcessGroup(processGroup: number): void {
  if (!Number.isInteger(processGroup) || processGroup <= 1)
    throw new RangeError(
      `Process group id ${processGroup} does not name one owned process group`,
    )
}
