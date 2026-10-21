import { readProcessTable } from './readProcessTable.mjs'

/**
 * Ends processes with SIGKILL, never this process or one of its parents.
 *
 * Why: the pids come from a look at a tree some time ago, and a pid can be given to another program once its process has ended; this process and its parents are the one set of pids that must never be hit, whatever a table said. A pid that is gone already is skipped.
 * Called by {@link trackProcessTree} and {@link collectTestRun}.
 * @param pids - The process ids found under a child.
 * @param options.platform - A value of `process.platform`, for {@link readProcessTable}.
 * @returns Nothing.
 * @example
 * killProcessIds(listProcessIdsUnder(child.pid))
 */
export function killProcessIds(pids, { platform = process.platform } = {}) {
  if (pids.length === 0) return
  const protectedPids = new Set([process.pid, process.ppid])
  // Walk up from the parent's parent: every process above this one is protected too, up to the first process of the system; a pid met again ends a table that loops.
  const table = readProcessTable({ platform })
  for (let pid = table?.get(process.ppid); pid > 0; pid = table.get(pid)) {
    if (protectedPids.has(pid)) break
    protectedPids.add(pid)
  }
  for (const pid of pids) {
    if (protectedPids.has(pid)) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // It ended already, or the system refused; there is nothing more to do for this pid.
    }
  }
}
