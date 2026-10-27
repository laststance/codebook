import { isGroupCertainlyGone } from './isGroupCertainlyGone'

/** Whether the process group a stop is about to signal is still the one the run launched. */
export type LaunchedGroupVerdict = 'launched' | 'replaced' | 'unverifiable'

/** What {@link confirmLaunchedGroup} compares and reads with. */
export type ConfirmLaunchedGroupInput = {
  /** The launched leader's pid, which is also its process group id. */
  pid: number
  /** The leader's start as it was read at launch; `undefined` when it could not be read then, so only the folder is compared. */
  startedAt?: string
  /** The working-folder realpath the leader was launched in. */
  cwd: string
  /** Whether the launcher saw the leader exit. */
  leaderExited: boolean
  readProcessStart(pid: number): Promise<string | undefined>
  readProcessCwd(pid: number): Promise<string | undefined>
  /** Whether no process of the group is left (a signal-0 probe of the group id, {@link isProcessGroupGone}); a probe that throws counts as "not gone". */
  isGroupGone(processGroup: number): boolean
}

/**
 * Tells whether a group id still belongs to the server the run launched, before a retried stop signals it again.
 * Why: a stop that failed leaves the group id behind; if the group ended meanwhile, the system may give the same id to an unrelated process group, and a repeated SIGKILL would hit it.
 * Called by the node-server run before its own retried SIGKILL and by the launcher's close before every signal of a retried close.
 * @param input - The leader's launch identity (start time, folder) and the readers ({@link ConfirmLaunchedGroupInput}).
 * @returns
 * - `launched` when the leader still has the launch start time and folder, or when nothing is readable and the group certainly has no member left (signalling it can reach no process)
 * - `replaced` when a readable leader has another start time or folder, or when any process is readable at the pid of a leader the launcher saw exit: the id belongs to another process now, nothing may be signalled
 * - `unverifiable` when nothing is readable while the group may still have members (a failed read and an absent process read alike), or only one of the two facts can be read
 * @example
 * await confirmLaunchedGroup({ pid: 4242, startedAt: 'Wed Oct 28 10:00:00 2026', cwd: '/repo/apps/api', leaderExited: false, readProcessStart, readProcessCwd, isGroupGone: isProcessGroupGone }) // => 'launched'
 */
export async function confirmLaunchedGroup(
  input: ConfirmLaunchedGroupInput,
): Promise<LaunchedGroupVerdict> {
  const [startedAt, cwd] = await Promise.all([
    input.readProcessStart(input.pid),
    input.readProcessCwd(input.pid),
  ])
  // Nothing readable: a failed ps or lsof query reads like an absent process, so only a group with no member left may count as the launched one.
  if (startedAt === undefined && cwd === undefined)
    return isGroupCertainlyGone(input.isGroupGone, input.pid)
      ? 'launched'
      : 'unverifiable'
  // The launcher saw its leader exit, so a process readable at that pid now is another one.
  if (input.leaderExited) return 'replaced'
  // A readable fact that differs from the launch identity names another process.
  if (
    (startedAt !== undefined &&
      input.startedAt !== undefined &&
      startedAt !== input.startedAt) ||
    (cwd !== undefined && cwd !== input.cwd)
  )
    return 'replaced'
  // Both facts must be read to call the leader the launched one (an unrecorded launch start compares the folder alone).
  if (cwd === undefined || startedAt === undefined) return 'unverifiable'
  return 'launched'
}
