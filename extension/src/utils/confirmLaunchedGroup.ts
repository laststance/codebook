import { isGroupCertainlyGone } from './isGroupCertainlyGone'

/** Whether the process group a stop is about to signal is still the one the run launched. */
export type LaunchedGroupVerdict =
  'launched' | 'gone' | 'replaced' | 'unverifiable'

/** What {@link confirmLaunchedGroup} compares and reads with. */
export type ConfirmLaunchedGroupInput = {
  /** The launched leader's pid, which is also its process group id. */
  pid: number
  /** The leader's start as it was read at launch; `undefined` when it could not be read then, so a running leader cannot be told from another process with its id. */
  startedAt?: string
  /** Whether the launcher saw the leader exit. */
  leaderExited: boolean
  readProcessStart(pid: number): Promise<string | undefined>
  /** Reads the leader's working folder; a readable one at the id of a leader that exited proves the id is another process's. */
  readProcessCwd(pid: number): Promise<string | undefined>
  /** Whether no process of the group is left (a signal-0 probe of the group id, {@link isProcessGroupGone}); a probe that throws counts as "not gone". */
  isGroupGone(processGroup: number): boolean
  /** Whether no process has the leader's id (signal 0 to the pid, {@link isProcessGone}); `false` while one has it or the probe fails. */
  isProcessGone(pid: number): boolean
}

/**
 * Tells whether a group id still belongs to the server the run launched, before a retried stop signals it again.
 * Why: a stop that failed leaves the group id behind; if the group ended meanwhile, the system may give the same id to an unrelated process group, and a repeated signal would hit it. A failed `ps` or `lsof` read looks like an absent process, so only a positive answer allows a signal.
 * Called by the node-server run before its own retried SIGKILL and by the launcher's close before every signal of a retried close.
 * @param input - The leader's launch identity (start time, folder) and the readers and probes ({@link ConfirmLaunchedGroupInput}).
 * @returns
 * - `gone` when the group has no member left: nothing may be signalled (another group could take the id after this check)
 * - `launched` when the leader has the launch start time (whatever its folder), or when the launcher saw the leader exit, no process has its id and the group still has members (an id is not given out while a group holds it, so these are the leader's survivors)
 * - `replaced` when a readable leader has another start time, or when any process is readable at the id of a leader the launcher saw exit: the id belongs to another process now, nothing may be signalled
 * - `unverifiable` when the group may have members and none of these holds (a leader that cannot be read, or no launch start time to compare with: a folder alone never authorizes a signal)
 * @example
 * await confirmLaunchedGroup({ pid: 4242, startedAt: 'Wed Oct 28 10:00:00 2026', leaderExited: false, readProcessStart, readProcessCwd, isGroupGone: isProcessGroupGone, isProcessGone }) // => 'launched'
 */
export async function confirmLaunchedGroup(
  input: ConfirmLaunchedGroupInput,
): Promise<LaunchedGroupVerdict> {
  // A group with no member left is never signalled again: another group could take its id after this check.
  if (isGroupCertainlyGone(input.isGroupGone, input.pid)) return 'gone'
  if (input.leaderExited) {
    const [startedAt, cwd] = await Promise.all([
      input.readProcessStart(input.pid),
      input.readProcessCwd(input.pid),
    ])
    // The launcher saw its leader exit, so a process readable at that id now is another one.
    if (startedAt !== undefined || cwd !== undefined) return 'replaced'
    // No process has the id while the group still has members: the leader's survivors (a failed probe proves nothing).
    return input.isProcessGone(input.pid) ? 'launched' : 'unverifiable'
  }
  // The folder is never read for a running leader: it can change and decides nothing.
  const startedAt = await input.readProcessStart(input.pid)
  // A start time compared with the launch's decides: the same is the launched leader, whatever its folder now; another is another process.
  if (startedAt !== undefined && input.startedAt !== undefined)
    return startedAt === input.startedAt ? 'launched' : 'replaced'
  // Without both start times nothing identifies the leader: a folder alone never authorizes a signal.
  return 'unverifiable'
}
