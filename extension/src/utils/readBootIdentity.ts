import { readFile } from 'node:fs/promises'
import { uptime } from 'node:os'

import {
  KERNEL_BOOT_ID_PATH,
  MILLISECONDS_PER_SECOND,
  PROCESS_START_QUERY_MAX_BYTES,
  PROCESS_START_QUERY_TIMEOUT_MS,
} from '../constants'

import type { BootIdentity } from './readRecordedOwner'
import { runBoundedQuery, type BoundedQueryRunner } from './runBoundedQuery'

/** The program that names macOS's boot session, by its full path, so no program of the current directory or the search path answers instead. */
const MAC_SYSCTL_PATH = '/usr/sbin/sysctl'

/** The boot session's id as `sysctl -n kern.bootsessionuuid` prints it: a UUID in capitals. */
const BOOT_SESSION_UUID =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i

/** The boot session of this macOS, read once per runner and kept for as long as this window runs: it cannot change while the process runs. */
const bootSessions = new WeakMap<
  BoundedQueryRunner,
  Promise<string | undefined>
>()

/** What {@link readBootIdentity} reads with: the system it runs on, and the runner of the macOS query; the real ones unless a test names its own. */
export type BootIdentityInputs = {
  platform?: NodeJS.Platform
  run?: BoundedQueryRunner
}

/**
 * Asks macOS for the id of its boot session (`kern.bootsessionuuid`), which names this start of the computer exactly and no clock moves; called by {@link readBootIdentity} on macOS, once per runner.
 * The query is bounded as a process start's is ({@link PROCESS_START_QUERY_TIMEOUT_MS}, {@link PROCESS_START_QUERY_MAX_BYTES}).
 * @param run - The runner of the query.
 * @returns The session's UUID; `undefined` when the query fails, runs too long, prints too much or prints no UUID.
 * @example await readMacBootSession(runBoundedQuery) // => '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14'
 */
async function readMacBootSession(
  run: BoundedQueryRunner,
): Promise<string | undefined> {
  const answer = await run(MAC_SYSCTL_PATH, ['-n', 'kern.bootsessionuuid'], {
    timeout: PROCESS_START_QUERY_TIMEOUT_MS,
    maxBuffer: PROCESS_START_QUERY_MAX_BYTES,
    killSignal: 'SIGKILL',
    windowsHide: true,
  }).catch(() => undefined)
  const text = answer?.stdout.trim() ?? ''
  return BOOT_SESSION_UUID.test(text) ? text : undefined
}

/**
 * Reads which start of this machine the process runs under, so that a storage owner recorded before a restart is recognised although its process id is in use again, and so that only an exact boot proves two records of one machine under two host names ({@link isSameStorageMachine}); called by {@link currentStorageOwner} each time an owner is recorded or judged.
 * The boot's id needs no clock: the kernel's boot id on Linux, the boot session on macOS ({@link readMacBootSession}, read once per window). Where the system names its boot by no id (Windows), and on macOS beside the id, the boot time is the wall clock minus the uptime, which a clock correction moves; {@link isFromEarlierBoot} compares it with a tolerance, for a record that names no boot id (one of 0.2.29.0), and it proves no machine.
 * The boot time serves records without a process start: those a window of 0.2.29.0 wrote or reads, and those of a window whose start could not be read. Between two windows of this build the owner's process start decides ({@link readProcessStart}), and {@link currentStorageOwner} records no boot time while its own start is unknown.
 * @param kernelBootIdPath - The file that holds the kernel's boot id; tests name one of their own.
 * @param inputs - The system and the macOS query's runner ({@link BootIdentityInputs}).
 * @returns
 * - `{ id }` with the kernel's boot id, where that file can be read and is not empty (Linux)
 * - `{ id, startedAtMs }` on macOS, with the boot session's id and the computed boot time; `{ startedAtMs }` alone when the session cannot be read
 * - `{ startedAtMs }` with the computed boot time everywhere else (Windows)
 * @example
 * await readBootIdentity()                 // => { id: '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d' } on Linux
 * await readBootIdentity()                 // => { id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14', startedAtMs: 1790000000000 } on macOS
 * await readBootIdentity('/no/such/file')  // => { startedAtMs: 1790000000000 } on Windows
 */
export async function readBootIdentity(
  kernelBootIdPath: string = KERNEL_BOOT_ID_PATH,
  inputs: BootIdentityInputs = {},
): Promise<BootIdentity> {
  const kernelBootId = await readFile(kernelBootIdPath, 'utf8').then(
    (text) => text.trim(),
    () => '',
  )
  if (kernelBootId) return { id: kernelBootId }
  const startedAtMs =
    Date.now() - Math.round(uptime() * MILLISECONDS_PER_SECOND)
  if ((inputs.platform ?? process.platform) !== 'darwin') return { startedAtMs }
  const run = inputs.run ?? runBoundedQuery
  // The session is read once per window: it cannot change while this process runs.
  let session = bootSessions.get(run)
  if (!session) {
    session = readMacBootSession(run)
    bootSessions.set(run, session)
  }
  const id = await session
  return id === undefined ? { startedAtMs } : { id, startedAtMs }
}
