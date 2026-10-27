import {
  NODE_SERVER_GROUP_EXIT_POLL_MS,
  NODE_SERVER_ORPHANS_STORAGE_KEY,
} from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { isGroupCertainlyGone } from './isGroupCertainlyGone'
import { isProcessGroupGone } from './isProcessGroupGone'
import {
  readNodeServerOrphanRecords,
  type NodeServerOrphanRecord,
  type NodeServerOrphanStore,
} from './nodeServerOrphanRecords'
import { readProcessPsField } from './readProcessPsField'
import { readProcessStart } from './readProcessStart'
import { signalProcessGroup } from './signalProcessGroup'

/** What {@link reapNodeServerOrphans} reads and does with. */
export type ReapNodeServerOrphansInput = {
  store: NodeServerOrphanStore
  /** Reads a process's start; {@link readProcessStart} by default. */
  readProcessStart?: (pid: number) => Promise<string | undefined>
  /** Signals a whole group; {@link signalProcessGroup} by default. */
  signalGroup?: (processGroup: number, signal: NodeJS.Signals) => void
  /** Says whether a group has no member left; {@link isProcessGroupGone} by default. */
  isGroupGone?: (processGroup: number) => boolean
  /** Reads this process's own group id, which is never signalled; `ps -o pgid=` by default. */
  readOwnProcessGroup?: () => Promise<number | undefined>
  /** Receives one plain line per closed group. */
  log: (line: string) => void
  /** How long the group has after SIGTERM before SIGKILL, in milliseconds. */
  graceMs: number
}

/**
 * Reads the editor process's own group id.
 * @returns The group id, or `undefined` when unreadable.
 * @example await readOwnProcessGroup() // => 52110
 */
async function readOwnProcessGroup(): Promise<number | undefined> {
  const text = await readProcessPsField(process.pid, 'pgid')
  return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined
}

/**
 * Closes the server groups an earlier window left running: SIGTERM, then SIGKILL after the grace period.
 * @param input - The injected readers and signals.
 * @param record - The recorded group, whose leader matched its start.
 * @example await closeOrphanGroup(input, record)
 */
async function closeOrphanGroup(
  input: Required<
    Omit<ReapNodeServerOrphansInput, 'store' | 'log' | 'readOwnProcessGroup'>
  > &
    Pick<ReapNodeServerOrphansInput, 'log'>,
  record: NodeServerOrphanRecord,
): Promise<void> {
  input.signalGroup(record.processGroup, 'SIGTERM')
  const gone = await waitUntil(
    () => input.isGroupGone(record.processGroup),
    'the server group to exit',
    input.graceMs,
    undefined,
    NODE_SERVER_GROUP_EXIT_POLL_MS,
  ).catch(() => false)
  if (!gone) input.signalGroup(record.processGroup, 'SIGKILL')
  input.log(
    `Closed a server left running by an earlier window (pid ${record.pid}, declared port ${record.declaredPort}).`,
  )
}

/** What the sweep did with one record. */
type OrphanOutcome = 'closed' | 'dropped' | 'kept'

/** The readers and signals a sweep of one record uses. */
type OrphanReaders = Parameters<typeof closeOrphanGroup>[0]

/**
 * Judges one record by the run's identity rule: a leader with the recorded start time is the launched one whatever its folder (a server may change its folder) and its group is closed; a different start drops the record; a leader that cannot be read while members remain keeps the record and is reported.
 * @param readers - The injected readers and signals.
 * @param record - The recorded group, already known to be led by its pid and not the editor's own.
 * @returns `'closed'` after signalling, `'dropped'` when nothing is left to find, `'kept'` when the record must stay for the next sweep.
 * @example await judgeOrphanRecord(readers, record) // => 'kept' when the leader's start could not be read and the group still has members, with a line naming its pid and declared port
 */
async function judgeOrphanRecord(
  readers: OrphanReaders,
  record: NodeServerOrphanRecord,
): Promise<OrphanOutcome> {
  const startedAt = await readers.readProcessStart(record.pid)
  // A different start time means the pid is another process now: drop the record, signal nothing.
  if (startedAt !== undefined && startedAt !== record.leaderStartedAt)
    return 'dropped'
  if (startedAt === undefined) {
    // Nothing is left of the group: no record to keep.
    if (isGroupCertainlyGone(readers.isGroupGone, record.processGroup))
      return 'dropped'
    // The leader is gone (or unreadable) but members remain: report them, signal nobody we cannot identify, keep the record.
    readers.log(
      `A server group left by an earlier window has no verifiable leader, but its members remain (pid ${record.pid}, declared port ${record.declaredPort}); Codebook did not signal processes it cannot identify.`,
    )
    return 'kept'
  }
  // The start matches: the launched leader, whatever its folder now.
  await closeOrphanGroup(readers, record)
  return 'closed'
}

/**
 * Sweeps one record without ever throwing, so one record's failure never skips the others.
 * @param readers - The injected readers, signals and logger.
 * @param record - The recorded group.
 * @param ownGroup - The editor's own group id, never signalled.
 * @returns The record's {@link OrphanOutcome}; a failure reads `'kept'` unless the group is certainly gone.
 * @example await sweepOrphanRecord(readers, record, 52110) // => 'closed'
 */
async function sweepOrphanRecord(
  readers: OrphanReaders,
  record: NodeServerOrphanRecord,
  ownGroup: number | undefined,
): Promise<OrphanOutcome> {
  try {
    // A group its leader does not lead, or the editor's own group, is never signalled.
    if (record.processGroup !== record.pid || record.processGroup === ownGroup)
      return 'dropped'
    return await judgeOrphanRecord(readers, record)
  } catch {
    readers.log(
      `Could not close a server left running by an earlier window (pid ${record.pid}, declared port ${record.declaredPort}).`,
    )
    // A failed read or signal proves nothing about the server: keep the record unless its group is certainly gone.
    return isGroupCertainlyGone(readers.isGroupGone, record.processGroup)
      ? 'dropped'
      : 'kept'
  }
}

/**
 * Closes node-server process groups that an earlier editor window left running (the window was killed or crashed), and empties the records it is done with.
 * Why: a recorded group whose leader still has the recorded start time is the launched server (the same rule as the run's retried stop); one whose start time differs is a recycled pid and is dropped with no signal. A record the sweep could not judge (a read failed or returned nothing while the group still has members, signalling threw) stays for the next sweep and is reported in the log with its pid and port, instead of losing the only trace of a running server.
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
    signalGroup: input.signalGroup ?? signalProcessGroup,
    isGroupGone: input.isGroupGone ?? isProcessGroupGone,
    graceMs: input.graceMs,
    log: input.log,
  }
  const readOwnGroup = input.readOwnProcessGroup ?? readOwnProcessGroup
  const records = readNodeServerOrphanRecords(input.store)
  const ownGroup = await readOwnGroup()
  let closed = 0
  const kept: NodeServerOrphanRecord[] = []
  for (const record of records) {
    const outcome = await sweepOrphanRecord(readers, record, ownGroup)
    if (outcome === 'closed') closed += 1
    if (outcome === 'kept') kept.push(record)
  }
  // Only the swept runs leave the store: a record written during the sweep stays, and so does a record the sweep could not judge.
  const swept = new Set(records.map((record) => record.runId))
  const remaining = [
    ...readNodeServerOrphanRecords(input.store).filter(
      (record) => !swept.has(record.runId),
    ),
    ...kept,
  ]
  await input.store.update(
    NODE_SERVER_ORPHANS_STORAGE_KEY,
    remaining.length > 0 ? remaining : undefined,
  )
  return closed
}
