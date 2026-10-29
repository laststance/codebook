import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import {
  EXTENSION_BROWSER_KILL_GRACE_MS,
  EXTENSION_BROWSER_POLL_MS,
} from '../../constants'

/** What {@link stopListedProcesses} acts through; each is the real one unless a test names its own. */
export type ProcessStopper = {
  platform: NodeJS.Platform
  /** Sends a signal; throws when the process is gone or not this user's. */
  signal: (pid: number, signal: NodeJS.Signals | 0) => void
  /** Ends a process tree on Windows (`taskkill /PID <pid> /T /F`). */
  taskkill: (pid: number) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

/** The real signals, `taskkill` and timer. */
export const REAL_PROCESS_STOPPER: ProcessStopper = {
  platform: process.platform,
  signal: (pid, signal) => {
    process.kill(pid, signal)
  },
  taskkill: (pid) =>
    new Promise<void>((resolve) => {
      const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      child.once('error', () => resolve())
      child.once('close', () => resolve())
    }),
  sleep: (ms) => delay(ms),
}

/**
 * Says whether a process still exists, by the null signal.
 * @param pid - The process id.
 * @param stopper - The signals in use.
 * @returns `true` while the process runs.
 * @example
 * isStillRunning(4242, REAL_PROCESS_STOPPER) // => false for a gone process
 */
function isStillRunning(
  pid: number,
  stopper: ProcessStopper,
  isGroupLeader = false,
): boolean {
  // A group leader that exited can leave members behind: its group still exists while any of them runs.
  if (isGroupLeader) {
    try {
      stopper.signal(-pid, 0)
      return true
    } catch {
      // No such group: the process itself is looked at below.
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
): Promise<number[]> {
  const isRunning = (pid: number): boolean =>
    isStillRunning(pid, stopper, groupLeaders.includes(pid))
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
  /** Processes spawned `detached` (their id is their group id); on POSIX each gets its signal as `process.kill(-pid, …)` first, then as `process.kill(pid, …)` when no such group exists. */
  groupLeaders?: readonly number[]
}

/**
 * Sends one signal to a process, or to its whole group when it leads one; called by {@link stopListedProcesses}.
 * @param pid - The process id.
 * @param signal - The signal.
 * @param isGroupLeader - Whether the process was spawned as a group leader.
 * @param stopper - The signals in use.
 * @example
 * signalProcess(4242, 'SIGTERM', true, REAL_PROCESS_STOPPER) // signals the group -4242, else the process 4242
 */
function signalProcess(
  pid: number,
  signal: NodeJS.Signals,
  isGroupLeader: boolean,
  stopper: ProcessStopper,
): void {
  if (isGroupLeader) {
    try {
      stopper.signal(-pid, signal)
      return
    } catch {
      // No such group: fall back to the process itself.
    }
  }
  try {
    stopper.signal(pid, signal)
  } catch {
    // A process that is gone already needs no signal.
  }
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
  for (const pid of pids) signalProcess(pid, 'SIGTERM', leads(pid), stopper)
  const leaders = options.groupLeaders ?? []
  // A leader counts as running while any member of its group does.
  const survivors = await stillRunningAfter(
    pids,
    EXTENSION_BROWSER_KILL_GRACE_MS,
    stopper,
    leaders,
  )
  for (const pid of survivors)
    signalProcess(pid, 'SIGKILL', leads(pid), stopper)
  return (
    (
      await stillRunningAfter(
        survivors,
        EXTENSION_BROWSER_KILL_GRACE_MS,
        stopper,
        leaders,
      )
    ).length === 0
  )
}
