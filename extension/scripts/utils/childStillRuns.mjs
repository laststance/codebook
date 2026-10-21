/**
 * Tells whether a spawned child has not exited yet.
 *
 * Why: an end that signals a child by its pid must not signal it once it has exited (its pid can belong to another program then), and Node keeps `exitCode` and `signalCode` `null` until the child has exited.
 * Called by {@link endProcessTree} before it ends a child and by {@link watchCallSilence} before the forced step of a silent call.
 * @param child - The spawned process.
 * @returns `true` while the child has neither exited nor been ended by a signal.
 * @example
 * if (childStillRuns(child)) child.kill('SIGSTOP')
 */
export function childStillRuns(child) {
  return child.exitCode === null && child.signalCode === null
}
