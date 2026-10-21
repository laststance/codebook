import { listProcessIdsUnder } from './listProcessIdsUnder.mjs'
import { readProcessTable } from './readProcessTable.mjs'

/** How many looks at the tree under the stopped processes are made at most: each look that finds a process nobody had stopped yet starts another, so a tree that grows faster than it is stopped cannot keep the end waiting. */
const MAX_STOP_LOOKS = 20
/** How many looks in a row must find nothing new before the stopped processes are killed: the second one confirms the first. */
const QUIET_LOOKS_TO_CONFIRM = 2

/** Collects the ids that are never to be hit: this process and every process above it, up to the first process of the system; a pid met again ends a table that loops. @example protectedProcessIds(readProcessTable()) // => Set { 4242, 4100, 1 } */
function protectedProcessIds(table) {
  const protectedPids = new Set([process.pid, process.ppid])
  for (let pid = table?.get(process.ppid); pid > 0; pid = table.get(pid)) {
    if (protectedPids.has(pid)) break
    protectedPids.add(pid)
  }
  return protectedPids
}

/** Stops a process with SIGSTOP, which no process can catch or ignore; a process that is gone is skipped. @example stopProcess(4301) */
function stopProcess(pid) {
  try {
    process.kill(pid, 'SIGSTOP')
  } catch {
    // It ended already, or the system refused; the kill that follows skips it the same way.
  }
}

/**
 * Stops the processes and everything under them, looking again for what a process started before it was stopped, and answers every id found.
 *
 * A stopped process starts nothing, but a process that was only just stopped may have started one a moment before: each look finds what the processes stopped so far started, those are stopped in turn, and the look is repeated until {@link QUIET_LOOKS_TO_CONFIRM} looks in a row find nothing new.
 * @example stopTreesUnder(new Set([4301]), new Set([4242]), 'linux') // => Set { 4301, 4302 }
 */
function stopTreesUnder(targets, protectedPids, platform) {
  for (const pid of targets) stopProcess(pid)
  let quietLooks = 0
  for (
    let looks = 0;
    quietLooks < QUIET_LOOKS_TO_CONFIRM && looks < MAX_STOP_LOOKS;
    looks += 1
  ) {
    const unseen = listProcessIdsUnder([...targets], { platform }).filter(
      (pid) => !targets.has(pid) && !protectedPids.has(pid),
    )
    quietLooks = unseen.length === 0 ? quietLooks + 1 : 0
    for (const pid of unseen) {
      targets.add(pid)
      stopProcess(pid)
    }
  }
  return targets
}

/**
 * Ends processes, and everything they started before their end, with SIGKILL, never this process or one of its parents.
 *
 * Why: the pids come from a look at a tree some time ago, and a pid can be given to another program once its process has ended; this process and its parents are the one set of pids that must never be hit, whatever a table said. A pid that is gone already is skipped.
 * A process a look found can have started another one since that look, and a process that SIGKILL has ended no longer has children (they are given to `init`), so the processes are first stopped with SIGSTOP, which no process can catch or ignore. The tree under them is then read while they can start nothing (the look is repeated until a second one confirms the first), and every process found is stopped as well; only then do all of them get SIGKILL. Where the process table cannot be read (Windows, no `/proc` and no `ps`) the pids are killed as they are.
 * Called by {@link trackProcessTree} and {@link collectTestRun}.
 * @param pids - The process ids found under a child.
 * @param options.platform - A value of `process.platform`, for {@link readProcessTable}.
 * @returns Nothing.
 * @example
 * killProcessIds(listProcessIdsUnder(child.pid))
 */
export function killProcessIds(pids, { platform = process.platform } = {}) {
  if (pids.length === 0) return
  const table = readProcessTable({ platform })
  const protectedPids = protectedProcessIds(table)
  const targets = new Set(pids.filter((pid) => !protectedPids.has(pid)))
  // Without a table there is no tree to read, and a stop would only be one more signal to a pid that may belong to another program.
  const toKill =
    table === undefined
      ? targets
      : stopTreesUnder(targets, protectedPids, platform)
  for (const pid of toKill) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // It ended already, or the system refused; there is nothing more to do for this pid.
    }
  }
}
