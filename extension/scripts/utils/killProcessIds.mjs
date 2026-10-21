import { haveProcessesStopped } from './haveProcessesStopped.mjs'
import { listProcessIdsUnder } from './listProcessIdsUnder.mjs'
import { readProcessTable } from './readProcessTable.mjs'

/**
 * How many looks at the tree under the stopped processes are made at most: each look that finds a process nobody had stopped yet, or that is made before every stopped process reported its stop, starts another.
 *
 * The bound is deliberate: the looks are synchronous (each one reads the process table and blocks the event loop, so the silence end, the signal handlers and the recording's abort wait for them), and a tree that grows faster than it is stopped must not hold the end for ever. After this many looks the end kills what it found, though the tree never settled; a process that the looks did not reach is not ended, and runs on.
 */
export const MAX_STOP_LOOKS = 20
/** How many looks in a row must confirm the tree before the stopped processes are killed: a look confirms when it finds nothing new and every process stopped so far has reported its stop; the second one confirms the first. */
export const QUIET_LOOKS_TO_CONFIRM = 2

/** Collects the ids that are never to be hit: this process and every process above it, up to the first process of the system; a pid met again ends a table that loops. @example protectedProcessIds(readProcessTable()) // => Set { 4242, 4100, 1 } */
function protectedProcessIds(table) {
  const protectedPids = new Set([process.pid, process.ppid])
  for (let pid = table?.get(process.ppid); pid > 0; pid = table.get(pid)) {
    if (protectedPids.has(pid)) break
    protectedPids.add(pid)
  }
  return protectedPids
}

/** Stops a process with SIGSTOP, which no process can catch or ignore, and answers whether the signal was sent; a process that is gone is skipped. @example stopProcess(4301) // => true */
function stopProcess(pid) {
  try {
    process.kill(pid, 'SIGSTOP')
    return true
  } catch {
    // It ended already, or the system refused; the kill that follows skips it the same way, and a stop that was not sent is not waited for.
    return false
  }
}

/**
 * Stops the processes and everything under them, looking again for what a process started before it was stopped, and answers every id found.
 *
 * SIGSTOP is delivered asynchronously: a process that is making a fork when the signal comes finishes the fork and stops only then, so the child of that fork is made after the signal was sent. A stopped process is in no system call, so once the table shows it stopped, every child it made is in the table. A look therefore waits for the stops: before each look the states of the processes stopped so far are read ({@link haveProcessesStopped}), and the look confirms the tree only when each of them has stopped (or is a zombie, dead or gone) and the look finds nothing new. The looks are repeated until {@link QUIET_LOOKS_TO_CONFIRM} looks in a row confirm, or {@link MAX_STOP_LOOKS} looks are made; what is found is stopped in turn. A process the stop could not be sent to is not waited for.
 * @example stopTreesUnder(new Set([4301]), new Set([4242]), 'linux') // => Set { 4301, 4302 }
 */
function stopTreesUnder(targets, protectedPids, platform) {
  // The processes SIGSTOP was sent to: only these can be waited for.
  const signalled = new Set()
  const stop = (pid) => {
    if (stopProcess(pid)) signalled.add(pid)
  }
  for (const pid of targets) stop(pid)
  let confirmingLooks = 0
  for (
    let looks = 0;
    confirmingLooks < QUIET_LOOKS_TO_CONFIRM && looks < MAX_STOP_LOOKS;
    looks += 1
  ) {
    // The states are read before the look lists the tree: a process that reports its stop here has made every child it will ever make.
    const haveStopped = haveProcessesStopped([...signalled], { platform })
    const unseen = listProcessIdsUnder([...targets], { platform }).filter(
      (pid) => !targets.has(pid) && !protectedPids.has(pid),
    )
    confirmingLooks =
      haveStopped && unseen.length === 0 ? confirmingLooks + 1 : 0
    for (const pid of unseen) {
      targets.add(pid)
      stop(pid)
    }
  }
  return targets
}

/**
 * Ends processes, and everything they started before their end, with SIGKILL, never this process or one of its parents.
 *
 * Why: the pids come from a look at a tree some time ago, and a pid can be given to another program once its process has ended; this process and its parents are the one set of pids that must never be hit, whatever a table said. A pid that is gone already is skipped.
 * A process a look found can have started another one since that look, and a process that SIGKILL has ended no longer has children (they are given to `init`), so the processes are first stopped with SIGSTOP, which no process can catch or ignore. The tree under them is then read while they can start nothing: a look counts only when every process stopped so far has reported its stop in the table (SIGSTOP is delivered asynchronously, and a process in the middle of a fork starts its child before it stops), and the look is repeated until a second one confirms the first. Every process found is stopped as well; only then do all of them get SIGKILL. Where the process table cannot be read (Windows, no `/proc` and no `ps`) the pids are killed as they are, with no stop and no look; where the table can be read and the states cannot (a `ps` without the state column) a look counts as it did before the states were read.
 *
 * The looks are bounded by {@link MAX_STOP_LOOKS}: a tree that keeps growing, or a process that never reports its stop, ends the looks after that many, and the end then kills what it found though the tree never settled. What the looks did not reach is not ended: a process started after the last look, under a process that was found late, runs on.
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
