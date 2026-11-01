import type { ProcessStartReader } from '../../utils/readProcessStart'

import type { ListedProcess } from './listProcesses'
import type { ProcessStopper } from './stopListedProcesses'

/**
 * Wraps a {@link ProcessStopper} so that it signals a process only while that process still has the start the proof recorded; the guard of the saved-session orphan stop ({@link stopOrphanBrowser}), because a pid that Chrome released can name another process by the time a later signal is sent.
 * The start is read again before the first signal (by the caller) and after every pause the stop makes between its signals (SIGTERM, grace, SIGKILL), and a signal, group signal or `taskkill` is sent only while the last read matched. A read that fails or differs sends nothing, so the stop ends as "still in use" instead of signalling a stranger.
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
    holds = (await readStart(target.pid)) === target.processStart
  }
  return {
    platform: stopper.platform,
    // Signal 0 only looks; every real signal needs the last look to have matched. A group signal carries the negated pid.
    signal: (pid, signal): void => {
      if (signal !== 0 && !holds) return
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
