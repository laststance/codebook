import { killProcessIds } from './killProcessIds.mjs'
import { listProcessIdsUnder } from './listProcessIdsUnder.mjs'

/**
 * Remembers the process ids under one process while it is being ended, and ends the ones that still run when the caller says so.
 *
 * Why: when a runner exits, the test-file processes it started lose their parent and can no longer be found from it, so the tree is read before the first signal and again while the call winds down. Each look follows the children of every process seen so far, so a process that was started under a known one after the first look is found too. A root that is only killed after its tree was read can start a process between the look and its end, and a killed root no longer has children (they are given to `init`), so that process is found by no later look: the end of a root therefore stops the root first ({@link stopAndLook}), so that it starts nothing while its tree is read.
 * Called by {@link watchCallSilence} for a call ended for its silence and by {@link endProcessTree} for a child ended at once.
 * @param rootPid - The process whose tree is tracked (the runner or the build).
 * @param options.platform - A value of `process.platform`.
 * @returns `{ look, stopAndLook, killRemaining }`: `look()` adds the processes under the root and under every known process; `stopAndLook(root)` stops the spawned root with SIGSTOP, which no process can catch or ignore, and looks twice, the second look confirming the first: what the root had started before it stopped is known then, and it starts nothing more; `killRemaining()` ends every known process, and what those started before their end, with SIGKILL ({@link killProcessIds}; the root is left to the caller) and forgets them.
 * @example
 * const tree = trackProcessTree(child.pid)
 * tree.stopAndLook(child)
 * tree.killRemaining()
 * child.kill('SIGKILL')
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
    stopAndLook(root) {
      // The stop comes first: from now on the root starts no process, so the looks below see everything it started.
      root.kill('SIGSTOP')
      this.look()
      this.look()
    },
    killRemaining() {
      killProcessIds([...known], { platform })
      known.clear()
    },
  }
}
