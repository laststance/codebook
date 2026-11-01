import type { ProcessStartReader } from '../../utils/readProcessStart'

import type { ListedProcess } from './listProcesses'
import type { ProcessStopper } from './stopListedProcesses'

/**
 * Wraps a {@link ProcessStopper} so that it signals a process only while that process still has the start the proof recorded; the guard of the saved-session orphan stop ({@link stopOrphanBrowser}), because a pid that Chrome released can name another process by the time a later signal is sent.
 * The start is read again before a `taskkill` and after every pause the stop makes between its signals (SIGTERM, grace, SIGKILL), and a signal, group signal or `taskkill` is sent only while every read matched.
 * The first read that fails or differs ends the proof for good: no later read is made, nothing more is signalled, and the null signal answers that the proven process is gone, so the stop's exit wait ends at once instead of polling a whole grace (on Windows each read can be a PowerShell query of up to 3 s). The caller's fresh listing then decides: "still in use" while anything names the folder.
 * @param stopper - The real signals, or a test's.
 * @param target - The proven main process and the start the marker recorded for it.
 * @param readStart - Reads the start of a process id now; no cache.
 * @returns A stopper with the same shape whose signals are conditional.
 * @example
 * const guarded = stopperGuardedByStart(REAL_PROCESS_STOPPER, { pid: 4242, processStart: 'ps:Mon Nov  2 10:00:00 2026' }, readProcessStart)
 */
export function stopperGuardedByStart(
  stopper: ProcessStopper,
  target: { pid: ListedProcess['pid']; processStart: string },
  readStart: ProcessStartReader,
): ProcessStopper {
  // The identity was proven by the caller right before the stop began.
  let holds = true
  const recheck = async (): Promise<void> => {
    // A lost identity never comes back: a start that failed or differed once is not trusted again, and costs no further read.
    if (!holds) return
    const start = await readStart(target.pid)
    holds &&= start === target.processStart
  }
  return {
    platform: stopper.platform,
    // Signal 0 only looks; every real signal needs every look so far to have matched. A group signal carries the negated pid.
    signal: (pid, signal): void => {
      if (!holds) {
        // The process the proof named is gone (it exited, its pid was reused, or its start cannot be read): the look says so, as `process.kill` does for a gone process.
        if (signal === 0) throw new Error('The proven process is gone')
        return
      }
      stopper.signal(pid, signal)
    },
    taskkill: async (pid): Promise<void> => {
      await recheck()
      if (holds) await stopper.taskkill(pid)
    },
    sleep: async (ms): Promise<void> => {
      await stopper.sleep(ms)
      await recheck()
    },
  }
}
