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
function isStillRunning(pid: number, stopper: ProcessStopper): boolean {
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
): Promise<number[]> {
  let remaining = pids.filter((pid) => isStillRunning(pid, stopper))
  // Poll until nothing runs or the wait is spent.
  for (
    let waited = 0;
    remaining.length > 0 && waited < waitMs;
    waited += EXTENSION_BROWSER_POLL_MS
  ) {
    await stopper.sleep(EXTENSION_BROWSER_POLL_MS)
    remaining = remaining.filter((pid) => isStillRunning(pid, stopper))
  }
  return remaining
}

/**
 * Stops the processes of an abandoned owned browser: SIGTERM, then SIGKILL after the grace time; `taskkill /T /F` on Windows (ER18).
 * Called by the orphan sweep ({@link removeAbandonedProfiles}) for processes whose command line carries exactly the dead run's profile folder; it signals nothing else.
 * @param pids - The matched processes.
 * @param stopper - The signals in use; the real ones in the product.
 * @returns `true` when none of them runs any more.
 * @example
 * await stopListedProcesses([4242, 4243], REAL_PROCESS_STOPPER) // => true
 */
export async function stopListedProcesses(
  pids: number[],
  stopper: ProcessStopper = REAL_PROCESS_STOPPER,
): Promise<boolean> {
  if (stopper.platform === 'win32') {
    for (const pid of pids) await stopper.taskkill(pid)
    return (await stillRunningAfter(pids, 0, stopper)).length === 0
  }
  for (const pid of pids) {
    try {
      stopper.signal(pid, 'SIGTERM')
    } catch {
      // A process that is gone already needs no signal.
    }
  }
  const survivors = await stillRunningAfter(
    pids,
    EXTENSION_BROWSER_KILL_GRACE_MS,
    stopper,
  )
  for (const pid of survivors) {
    try {
      stopper.signal(pid, 'SIGKILL')
    } catch {
      // It ended between the check and the signal.
    }
  }
  return (
    (
      await stillRunningAfter(
        survivors,
        EXTENSION_BROWSER_KILL_GRACE_MS,
        stopper,
      )
    ).length === 0
  )
}
