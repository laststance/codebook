import { killProcessIds } from './killProcessIds.mjs'
import { listProcessIdsUnder } from './listProcessIdsUnder.mjs'

/**
 * Remembers the process ids under one process while it is being ended, and ends the ones that still run when the caller says so.
 *
 * Why: when a runner exits, the test-file processes it started lose their parent and can no longer be found from it, so the tree is read before the first signal and again while the call winds down. Each look follows the children of every process seen so far, so a process that was started under a known one after the first look is found too.
 * Called by {@link watchCallSilence} for a call ended for its silence and by {@link endProcessTree} for a child ended at once.
 * @param rootPid - The process whose tree is tracked (the runner or the build).
 * @param options.platform - A value of `process.platform`.
 * @returns `{ look, killRemaining }`: `look()` adds the processes under the root and under every known process; `killRemaining()` ends every known process with SIGKILL (the root is left to the caller) and forgets them.
 * @example
 * const tree = trackProcessTree(child.pid)
 * tree.look()
 * child.kill('SIGTERM')
 * tree.killRemaining()
 */
export function trackProcessTree(
  rootPid,
  { platform = process.platform } = {},
) {
  const known = new Set()
  return {
    look() {
      if (rootPid === undefined) return
      for (const pid of listProcessIdsUnder([rootPid, ...known], { platform }))
        known.add(pid)
    },
    killRemaining() {
      killProcessIds([...known], { platform })
      known.clear()
    },
  }
}
