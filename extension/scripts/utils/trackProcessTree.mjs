import { haveProcessesStopped } from './haveProcessesStopped.mjs'
import {
  killProcessIds,
  MAX_STOP_LOOKS,
  QUIET_LOOKS_TO_CONFIRM,
} from './killProcessIds.mjs'
import { listProcessIdsUnder } from './listProcessIdsUnder.mjs'

/**
 * Remembers the process ids under one process while it is being ended, and ends the ones that still run when the caller says so.
 *
 * Why: when a runner exits, the test-file processes it started lose their parent and can no longer be found from it, so the tree is read before the first signal and again while the call winds down. Each look follows the children of every process seen so far, so a process that was started under a known one after the first look is found too. A root that is only killed after its tree was read can start a process between the look and its end, and a killed root no longer has children (they are given to `init`), so that process is found by no later look: the end of a root therefore stops the root first ({@link stopAndLook}), so that it starts nothing while its tree is read.
 * Called by {@link watchCallSilence} for a call ended for its silence and by {@link endProcessTree} for a child ended at once.
 * @param rootPid - The process whose tree is tracked (the runner or the build).
 * @param options.platform - A value of `process.platform`.
 * @returns `{ look, stopAndLook, killRemaining }`: `look()` adds the processes under the root and under every known process; `stopAndLook(root)` stops the spawned root with SIGSTOP, which no process can catch or ignore, and looks until two looks in a row were made after the root reported its stop in the table (the second look confirming the first; at most {@link MAX_STOP_LOOKS} looks): what the root had started before it stopped is known then, and it starts nothing more; where the states cannot be read, a look counts as it did before the states were read, and a root that is not running is not waited for; `killRemaining()` ends every known process, and what those started before their end, with SIGKILL ({@link killProcessIds}; the root is left to the caller) and forgets them.
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
      // The stop comes first, but it is delivered asynchronously: a root in the middle of a fork starts its child before it stops. A stop that was not sent (the root is gone, or the system refused) will never be reported and is not waited for.
      const stopSent = root.kill('SIGSTOP')
      let confirmingLooks = 0
      for (
        let looks = 0;
        confirmingLooks < QUIET_LOOKS_TO_CONFIRM && looks < MAX_STOP_LOOKS;
        looks += 1
      ) {
        // The state is read before the look: a root that reports its stop has started everything it will ever start, so a look after that sees all of it.
        const rootStopped =
          !stopSent || haveProcessesStopped([root.pid], { platform })
        this.look()
        confirmingLooks = rootStopped ? confirmingLooks + 1 : 0
      }
    },
    killRemaining() {
      killProcessIds([...known], { platform })
      known.clear()
    },
  }
}
