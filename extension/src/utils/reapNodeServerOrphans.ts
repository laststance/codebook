import { NODE_SERVER_ORPHANS_STORAGE_KEY } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { isProcessGroupGone } from './isProcessGroupGone'
import {
  readNodeServerOrphanRecords,
  type NodeServerOrphanRecord,
  type NodeServerOrphanStore,
} from './nodeServerOrphanRecords'
import { readProcessCwd } from './readProcessCwd'
import { readProcessStart } from './readProcessStart'
import { signalProcessGroup } from './signalProcessGroup'

/** What {@link reapNodeServerOrphans} reads and does with. */
export type ReapNodeServerOrphansInput = {
  store: NodeServerOrphanStore
  /** Reads a process's start; {@link readProcessStart} by default. */
  readProcessStart?: (pid: number) => Promise<string | undefined>
  /** Reads a process's working folder realpath; {@link readProcessCwd} by default. */
  readProcessCwd?: (pid: number) => Promise<string | undefined>
  /** Signals a whole group; {@link signalProcessGroup} by default. */
  signalGroup?: (processGroup: number, signal: NodeJS.Signals) => void
  /** Says whether a group has no member left; {@link isProcessGroupGone} by default. */
  isGroupGone?: (processGroup: number) => boolean
  /** Receives one plain line per closed group. */
  log: (line: string) => void
  /** How long the group has after SIGTERM before SIGKILL, in milliseconds. */
  graceMs: number
}

/**
 * Closes the server groups an earlier window left running: SIGTERM, then SIGKILL after the grace period.
 * @param input - The injected readers and signals.
 * @param record - The recorded group, whose leader matched its start and folder.
 * @example await closeOrphanGroup(input, record)
 */
async function closeOrphanGroup(
  input: Required<Omit<ReapNodeServerOrphansInput, 'store' | 'log'>> &
    Pick<ReapNodeServerOrphansInput, 'log'>,
  record: NodeServerOrphanRecord,
): Promise<void> {
  input.signalGroup(record.processGroup, 'SIGTERM')
  const gone = await waitUntil(
    () => input.isGroupGone(record.processGroup),
    'the server group to exit',
    input.graceMs,
    undefined,
    50,
  ).catch(() => false)
  if (!gone) input.signalGroup(record.processGroup, 'SIGKILL')
  input.log(
    `Closed a server left running by an earlier window (pid ${record.pid}, declared port ${record.declaredPort}).`,
  )
}

/**
 * Closes node-server process groups that an earlier editor window left running (the window was killed or crashed), and empties the records.
 * Why: a recorded group whose leader still has the recorded start time and working folder is certainly the launched server; one that does not match is a recycled pid and is dropped with no signal.
 * Called by the extension on activation with the workspace storage.
 * @param input - The store, the readers and signal functions to use, the logger and the SIGTERM-to-SIGKILL grace ({@link ReapNodeServerOrphansInput}).
 * @returns The number of groups that were signalled.
 * @example
 * await reapNodeServerOrphans({ store: context.workspaceState, log: (line) => output.appendLine(line), graceMs: 5_000 }) // => 1
 */
export async function reapNodeServerOrphans(
  input: ReapNodeServerOrphansInput,
): Promise<number> {
  const readers = {
    readProcessStart: input.readProcessStart ?? readProcessStart,
    readProcessCwd: input.readProcessCwd ?? readProcessCwd,
    signalGroup: input.signalGroup ?? signalProcessGroup,
    isGroupGone: input.isGroupGone ?? isProcessGroupGone,
    graceMs: input.graceMs,
    log: input.log,
  }
  const records = readNodeServerOrphanRecords(input.store)
  let closed = 0
  for (const record of records) {
    const [startedAt, cwd] = await Promise.all([
      readers.readProcessStart(record.pid),
      readers.readProcessCwd(record.pid),
    ])
    // A different start or folder means the pid is another process now: drop the record, signal nothing.
    if (startedAt !== record.leaderStartedAt || cwd !== record.cwd) continue
    await closeOrphanGroup(readers, record)
    closed += 1
  }
  await input.store.update(NODE_SERVER_ORPHANS_STORAGE_KEY, undefined)
  return closed
}
