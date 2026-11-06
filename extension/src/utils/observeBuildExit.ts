import type { EventEmitter } from 'node:events'

import type { BuildProcessExit } from './buildProcessTypes'

/**
 * Turns the events of a build's leader process into an `exited` promise that a pipe-holding grandchild cannot delay.
 *
 * Why it exists: `close` also waits for the stdio pipes, so a grandchild keeping stdout open would make a finished build read as a timeout.
 * The exit is recorded on `exit`; the promise settles on `close` (output flushed) or after the flush bound, whichever is first.
 * Called by {@link createBuildSpawner}.
 *
 * @param child - The leader process (anything that emits `error`, `exit` and `close`).
 * @param flushMs - How long to wait for `close` after `exit`.
 * @returns
 * - `exited`: settles once, never rejects; a failed start is an exit with no code
 * - `hasLeaderExited`: whether the leader has exited or failed to start
 * @example
 * const { exited } = observeBuildExit(child, 1_000)
 */
export function observeBuildExit(
  child: EventEmitter,
  flushMs: number,
): { exited: Promise<BuildProcessExit>; hasLeaderExited(): boolean } {
  let leaderExited = false
  const exited = new Promise<BuildProcessExit>((resolve) => {
    child.once('error', () => {
      leaderExited = true
      resolve({ code: null, signal: null })
    })
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      leaderExited = true
      // Output pipes may stay open in a grandchild; the exit settles after the bound at the latest.
      setTimeout(() => resolve({ code, signal }), flushMs).unref()
    })
    child.once(
      'close',
      (code: number | null, signal: NodeJS.Signals | null) => {
        leaderExited = true
        resolve({ code, signal })
      },
    )
  })
  return { exited, hasLeaderExited: () => leaderExited }
}
