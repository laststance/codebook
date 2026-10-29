import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import {
  EXTENSION_BROWSER_KILL_GRACE_MS,
  EXTENSION_BROWSER_POLL_MS,
} from '../../constants'
import { windowsSystemProgramPath } from '../../utils/windowsSystemProgramPath'

/** Where `taskkill` lies under the Windows system root. */
const TASKKILL_UNDER_SYSTEM_ROOT = ['System32', 'taskkill.exe']

/** What {@link stopListedProcesses} acts through; each is the real one unless a test names its own. */
export type ProcessStopper = {
  platform: NodeJS.Platform
  /** Sends a signal; throws when the process is gone or not this user's. */
  signal: (pid: number, signal: NodeJS.Signals | 0) => void
  /** Ends a process tree on Windows (`%SystemRoot%\System32\taskkill.exe /PID <pid> /T /F`, by its full path). */
  taskkill: (pid: number) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

/** The real signals, `taskkill` and timer. */
export const REAL_PROCESS_STOPPER: ProcessStopper = {
  platform: process.platform,
  signal: (pid, signal) => {
    process.kill(pid, signal)
  },
  taskkill: (pid) => {
    const program = windowsSystemProgramPath(TASKKILL_UNDER_SYSTEM_ROOT)
    // Without a system root on a drive letter no taskkill is started (one of another folder could run in its place); the exit check then reports the process as left.
    if (program === undefined) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const child = spawn(program, ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', () => resolve())
      child.once('close', () => resolve())
    })
  },
  sleep: (ms) => delay(ms),
}

/**
 * Says whether a process still exists, by the null signal.
 * @param pid - The process id.
 * @param stopper - The signals in use.
 * @param isGroupLeader - Whether the process was spawned as a group leader; its group is looked at first.
 * @param wasGroupReached - Whether the first SIGTERM reached its group; a group that is gone then means the process ended, and its id is never looked at alone.
 * @returns `true` while the process (or its group) runs.
 * @example
 * isStillRunning(4242, REAL_PROCESS_STOPPER) // => false for a gone process
 */
function isStillRunning(
  pid: number,
  stopper: ProcessStopper,
  isGroupLeader = false,
  wasGroupReached = false,
): boolean {
  // A group leader that exited can leave members behind: its group still exists while any of them runs.
  if (isGroupLeader) {
    try {
      stopper.signal(-pid, 0)
      return true
    } catch {
      // A group the first signal reached and that is gone has ended: its id may name an unrelated process by now.
      if (wasGroupReached) return false
      // No such group from the start: the process itself is looked at below.
    }
  }
  try {
    stopper.signal(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Waits until every process is gone or the time is up.
 * @param pids - The processes.
 * @param waitMs - The longest wait.
 * @param stopper - The signals and timer in use.
 * @returns The processes still running.
 * @example
 * await stillRunningAfter([4242], 5_000, REAL_PROCESS_STOPPER) // => []
 */
async function stillRunningAfter(
  pids: number[],
  waitMs: number,
  stopper: ProcessStopper,
  groupLeaders: readonly number[] = [],
  reachedGroups: ReadonlySet<number> = new Set(),
): Promise<number[]> {
  const isRunning = (pid: number): boolean =>
    isStillRunning(
      pid,
      stopper,
      groupLeaders.includes(pid),
      reachedGroups.has(pid),
    )
  let remaining = pids.filter(isRunning)
  // Poll until nothing runs or the wait is spent.
  for (
    let waited = 0;
    remaining.length > 0 && waited < waitMs;
    waited += EXTENSION_BROWSER_POLL_MS
  ) {
    await stopper.sleep(EXTENSION_BROWSER_POLL_MS)
    remaining = remaining.filter(isRunning)
  }
  return remaining
}

/** Which of the stopped processes lead a process group of their own, so one signal reaches their helpers too. */
export type StopOptions = {
  /** Processes spawned `detached` (their id is their group id); on POSIX each gets its signal as `process.kill(-pid, …)` first, then as `process.kill(pid, …)` when no such group exists at the first SIGTERM. Once the SIGTERM reached the group, only the group is looked at and signalled: a gone group means the browser ended, and its id may name an unrelated process by then. */
  groupLeaders?: readonly number[]
}

/**
 * Sends one signal to a process, or to its whole group when it leads one; called by {@link stopListedProcesses}.
 * @param pid - The process id.
 * @param signal - The signal.
 * @param isGroupLeader - Whether the process was spawned as a group leader.
 * @param stopper - The signals in use.
 * @param wasGroupReached - Whether an earlier signal reached its group; then only the group is signalled, since a gone group means the process ended and its id may name an unrelated process.
 * @returns `true` when the signal reached the group.
 * @example
 * signalProcess(4242, 'SIGTERM', true, REAL_PROCESS_STOPPER) // => true after signalling the group -4242; false after falling back to the process 4242
 */
function signalProcess(
  pid: number,
  signal: NodeJS.Signals,
  isGroupLeader: boolean,
  stopper: ProcessStopper,
  wasGroupReached = false,
): boolean {
  if (isGroupLeader) {
    try {
      stopper.signal(-pid, signal)
      return true
    } catch {
      // A group reached before and gone now has ended: its id is never signalled alone.
      if (wasGroupReached) return false
      // No such group from the start: fall back to the process itself.
    }
  }
  try {
    stopper.signal(pid, signal)
  } catch {
    // A process that is gone already needs no signal.
  }
  return false
}

/**
 * Stops the processes of an owned browser: SIGTERM, then SIGKILL after the grace time; `taskkill /T /F` on Windows (ER18).
 * Called by the owned launch's close for its own browser and by the orphan sweep ({@link removeAbandonedProfiles}) for processes proven to be the dead run's browser; it signals nothing else.
 * @param pids - The matched processes.
 * @param stopper - The signals in use; the real ones in the product.
 * @param options - The processes that lead their own group ({@link StopOptions}).
 * @returns `true` when none of them runs any more; on Windows the exit is awaited for the same grace time as a SIGKILL, since `taskkill` can return before the process is gone.
 * @example
 * await stopListedProcesses([4242, 4243], REAL_PROCESS_STOPPER) // => true
 */
export async function stopListedProcesses(
  pids: number[],
  stopper: ProcessStopper = REAL_PROCESS_STOPPER,
  options: StopOptions = {},
): Promise<boolean> {
  if (stopper.platform === 'win32') {
    for (const pid of pids) await stopper.taskkill(pid)
    return (
      (await stillRunningAfter(pids, EXTENSION_BROWSER_KILL_GRACE_MS, stopper))
        .length === 0
    )
  }
  const leads = (pid: number): boolean =>
    options.groupLeaders?.includes(pid) ?? false
  // A leader whose group the SIGTERM reached is looked at and signalled through that group only from now on.
  const reachedGroups = new Set<number>()
  for (const pid of pids)
    if (signalProcess(pid, 'SIGTERM', leads(pid), stopper))
      reachedGroups.add(pid)
  const leaders = options.groupLeaders ?? []
  // A leader counts as running while any member of its group does.
  const survivors = await stillRunningAfter(
    pids,
    EXTENSION_BROWSER_KILL_GRACE_MS,
    stopper,
    leaders,
    reachedGroups,
  )
  for (const pid of survivors)
    signalProcess(pid, 'SIGKILL', leads(pid), stopper, reachedGroups.has(pid))
  return (
    (
      await stillRunningAfter(
        survivors,
        EXTENSION_BROWSER_KILL_GRACE_MS,
        stopper,
        leaders,
        reachedGroups,
      )
    ).length === 0
  )
}
