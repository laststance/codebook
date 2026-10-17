import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { win32 } from 'node:path'
import { promisify } from 'node:util'

import {
  LINUX_STAT_START_TIME_INDEX,
  PROCESS_START_FORMS,
  PROCESS_START_PS_TEXT_MAX_LENGTH,
  PROCESS_START_QUERY_MAX_BYTES,
  PROCESS_START_QUERY_TIMEOUT_MS,
  PROCESS_START_RETRY_AFTER_FAILURE_MS,
} from '../constants'

import {
  processStartFormHere,
  type ProcessStartFormInputs,
} from './processStartFormHere'

/** What a start query is run with: its bounds, no console window on Windows, and for `ps` the locale and time zone its answer is printed in. */
type ProcessStartQueryOptions = {
  timeout: number
  maxBuffer: number
  killSignal: 'SIGKILL'
  windowsHide: true
  env?: Record<string, string>
}

/** This process's own start as {@link readProcessStart} keeps it: the read that is under way, and the last one that ended with the clock's time at its end. */
type OwnProcessStart = {
  reading?: Promise<string | undefined>
  read?: { start: string | undefined; atMs: number }
}

/** What {@link readProcessStart} reads with; each is the real one unless a caller or a test names its own. `platform` is the system whose query is used, and `readLink` reads the pid namespace a Linux start is named with ({@link ProcessStartFormInputs}). */
export type ProcessStartInputs = ProcessStartFormInputs & {
  /** Reads `/proc/<pid>/stat` as text (Linux). */
  readFile?: (path: string) => Promise<string>
  /** Runs `ps` (macOS) or PowerShell (Windows) without a shell and answers what it printed; it rejects when the query fails, runs too long or prints too much. */
  run?: (
    file: string,
    queryArguments: string[],
    options: ProcessStartQueryOptions,
  ) => Promise<{ stdout: string }>
  /** The starts one sweep has read so far, by process id; the caller owns it and drops it with its sweep. A kept start is answered only when it equals `expectedStart`. */
  cache?: Map<number, Promise<string | undefined>>
  /** The start a record names for this process id, which a start kept in `cache` may confirm. */
  expectedStart?: string
  /** Where this process's own start is kept; the one of this module unless a test names its own. */
  ownStart?: OwnProcessStart
  /** A clock that no correction of the wall clock moves (milliseconds), by which a failed read of this process's own start is read again. */
  now?: () => number
  /** How long one start query may run before it is ended (milliseconds); {@link PROCESS_START_QUERY_TIMEOUT_MS} unless a caller names its own, as a test does that waits for a real PowerShell that starts cold. */
  queryTimeoutMs?: number
  /** The environment the Windows system root is read from (`SystemRoot`), under which PowerShell is started by its full path; `process.env` unless a test names its own. */
  environment?: { SystemRoot?: string }
}

/** A reader of a process's start as the storage judgements take one: {@link readProcessStart}, one that adds its caller's cache, or a test's own. */
export type ProcessStartReader = typeof readProcessStart

/** Where Windows PowerShell lies under the Windows system root, and its bare name, by which it is started only where that root is unknown. */
const WINDOWS_POWERSHELL = {
  underSystemRoot: ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
  bareName: 'powershell.exe',
}
/** One line of printable ASCII of at most {@link PROCESS_START_PS_TEXT_MAX_LENGTH} characters, as `ps -o lstart=` prints a start in the C locale. */
const PS_START_LINE = new RegExp(
  `^[\\x20-\\x7e]{1,${PROCESS_START_PS_TEXT_MAX_LENGTH}}$`,
)
/** A UTC time in the round-trip form PowerShell's `ToString('o')` prints; an error text never has it. */
const WINDOWS_UTC_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
/** Only digits, as the kernel writes the start time of a process in clock ticks. */
const CLOCK_TICKS = /^\d+$/

/** This process's own start, the only start kept beyond one sweep: it cannot change while the process runs. */
const ownProcessStart: OwnProcessStart = {}

/**
 * Gives the bounds of one start query: a query that runs longer or prints more is ended, with a signal no process can ignore; called by {@link macStartOf} and {@link windowsStartOf} for the query they run.
 * @param inputs - The bound of {@link ProcessStartInputs} a caller may name (`queryTimeoutMs`).
 * @returns The options of the query: the caller's time bound, or {@link PROCESS_START_QUERY_TIMEOUT_MS}; {@link PROCESS_START_QUERY_MAX_BYTES}; the signal `SIGKILL`; and no console window on Windows.
 * @example
 * queryBoundsOf({})                         // => { timeout: 3_000, maxBuffer: 1_024, killSignal: 'SIGKILL', windowsHide: true }
 * queryBoundsOf({ queryTimeoutMs: 30_000 }) // => { timeout: 30_000, maxBuffer: 1_024, killSignal: 'SIGKILL', windowsHide: true }
 */
function queryBoundsOf(
  inputs: Pick<ProcessStartInputs, 'queryTimeoutMs'>,
): ProcessStartQueryOptions {
  return {
    timeout: inputs.queryTimeoutMs ?? PROCESS_START_QUERY_TIMEOUT_MS,
    maxBuffer: PROCESS_START_QUERY_MAX_BYTES,
    killSignal: 'SIGKILL',
    windowsHide: true,
  }
}

/**
 * Names the program the Windows query starts, by its full path, so that no `powershell.exe` in the process's current directory or earlier in the search path is started in its place; called by {@link windowsStartOf}.
 * Windows PowerShell lies at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. A bare name is looked up in the current directory first and then in the search path.
 * @param environment - Where the system root is read from; `process.env`, whose names Windows reads without regard to case, unless a test names its own.
 * @returns The full path under `SystemRoot`; the bare name `powershell.exe` where that variable is absent, empty or no absolute Windows path, since a path that is not absolute would again be looked up from the current directory.
 * @example
 * windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }) // => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 * windowsPowerShellPath({})                            // => 'powershell.exe'
 */
function windowsPowerShellPath(
  environment: NonNullable<ProcessStartInputs['environment']> = process.env,
): string {
  const systemRoot = environment.SystemRoot
  return systemRoot !== undefined && win32.isAbsolute(systemRoot)
    ? win32.join(systemRoot, ...WINDOWS_POWERSHELL.underSystemRoot)
    : WINDOWS_POWERSHELL.bareName
}

/** Runs one start query without a shell and closes its input, which neither query reads and which, left open, can keep PowerShell waiting. @example await runQuery('/bin/ps', ['-o', 'lstart=', '-p', '4242'], queryBoundsOf({})) // => { stdout: 'Mon Oct  5 09:12:33 2026\n', stderr: '' } */
const runQuery: NonNullable<ProcessStartInputs['run']> = (
  file,
  queryArguments,
  options,
) => {
  const query = promisify(execFile)(file, queryArguments, options)
  query.child.stdin?.end()
  return query
}

/** Reads a file as text; the file read of {@link linuxStartOf} unless a test names its own. @example await readText('/proc/4242/stat') // => '4242 (node) S 1 …' */
const readText: NonNullable<ProcessStartInputs['readFile']> = (path) =>
  readFile(path, 'utf8')

/** The clock no correction of the wall clock moves; the clock of {@link readOwnProcessStart} unless a test names its own. @example monotonicNow() // => 5234.5 */
const monotonicNow: NonNullable<ProcessStartInputs['now']> = () =>
  performance.now()

/**
 * Reads the start time out of the text of `/proc/<pid>/stat`; called by {@link linuxStartOf}.
 * @param stat - The file's text. Its second field, the command name, is in parentheses and may itself hold spaces and parentheses.
 * @returns
 * - Field 22, the start in clock ticks since the boot, as its digits
 * - `undefined` for a text without a command name, with too few fields, or whose field 22 is not a number
 * @example
 * startTicksInLinuxStat('4242 (node) S 1 4242 4242 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 16362446 1 1') // => '16362446'
 * startTicksInLinuxStat('4242 (node) S 1')                                                              // => undefined
 */
function startTicksInLinuxStat(stat: string): string | undefined {
  const nameEnd = stat.lastIndexOf(')')
  if (nameEnd === -1) return undefined
  // The fields are counted after the last ")": a command name can hold any text, also ") S 1".
  const ticks = stat
    .slice(nameEnd + 1)
    .trim()
    .split(' ')[LINUX_STAT_START_TIME_INDEX]
  return ticks !== undefined && CLOCK_TICKS.test(ticks) ? ticks : undefined
}

/**
 * Reads when a process began from the kernel's own record of it; the query of {@link START_QUERIES} on Linux.
 * The start is named with the pid namespace it was read in ({@link processStartFormHere}): the same process id and the same clock tick in another namespace of this kernel are another process.
 * @param pid - A positive safe integer.
 * @param inputs - The file read and the read of the namespace link of {@link ProcessStartInputs}.
 * @returns `linux@<namespace>:<ticks>` with what {@link startTicksInLinuxStat} reads in `/proc/<pid>/stat`, or `linux:<ticks>` when the namespace cannot be read; `undefined` when the stat holds no start.
 * @throws What the file read rejects with, for example when no process has the id.
 * @example
 * await linuxStartOf(4242, {}) // => 'linux@4026531836:16362446'
 */
async function linuxStartOf(
  pid: number,
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  const ticks = startTicksInLinuxStat(
    await (inputs.readFile ?? readText)(`/proc/${pid}/stat`),
  )
  if (ticks === undefined) return undefined
  const form = processStartFormHere({
    platform: 'linux',
    readLink: inputs.readLink,
  })
  return `${form}:${ticks}`
}

/**
 * Asks `ps` when a process began; the query of {@link START_QUERIES} on macOS.
 * The answer is printed in the C locale and in UTC, because `ps` prints it in the asking process's locale and time zone, and two windows with different ones must read the same text.
 * @param pid - A positive safe integer.
 * @param inputs - The runner and the time bound of {@link ProcessStartInputs}.
 * @returns `ps:<text>` for one printable line of at most {@link PROCESS_START_PS_TEXT_MAX_LENGTH} characters; `undefined` for any other answer.
 * @throws What the runner rejects with: `ps` ended with an error (no such process), ran too long or printed too much.
 * @example
 * await macStartOf(4242, {}) // => 'ps:Mon Oct  5 09:12:33 2026'
 */
async function macStartOf(
  pid: number,
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  const { stdout } = await (inputs.run ?? runQuery)(
    '/bin/ps',
    ['-o', 'lstart=', '-p', `${pid}`],
    { ...queryBoundsOf(inputs), env: { LC_ALL: 'C', TZ: 'UTC' } },
  )
  const text = stdout.trim()
  return PS_START_LINE.test(text)
    ? `${PROCESS_START_FORMS.darwin}:${text}`
    : undefined
}

/**
 * Asks PowerShell when a process was created; the query of {@link START_QUERIES} on Windows.
 * PowerShell is started by its full path under the system root ({@link windowsPowerShellPath}).
 * @param pid - A positive safe integer; it is the only part of the arguments that varies.
 * @param inputs - The runner, the time bound and the environment of {@link ProcessStartInputs}.
 * @returns `win:<text>` for a UTC time in round-trip form; `undefined` for any other answer, for example the localized error text PowerShell prints for a process id that names no process.
 * @throws What the runner rejects with: PowerShell is missing or blocked, ended with an error, ran too long or printed too much.
 * @example
 * await windowsStartOf(4242, {}) // => 'win:2026-10-05T09:12:33.1234567Z'
 */
async function windowsStartOf(
  pid: number,
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  const { stdout } = await (inputs.run ?? runQuery)(
    windowsPowerShellPath(inputs.environment),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ],
    queryBoundsOf(inputs),
  )
  const text = stdout.trim()
  return WINDOWS_UTC_START.test(text)
    ? `${PROCESS_START_FORMS.win32}:${text}`
    : undefined
}

/** The query of each system on which a process's start can be read; every other system has none. */
const START_QUERIES: Partial<
  Record<
    NodeJS.Platform,
    (pid: number, inputs: ProcessStartInputs) => Promise<string | undefined>
  >
> = { linux: linuxStartOf, darwin: macStartOf, win32: windowsStartOf }

/**
 * Asks the system now when a process began; called by {@link readThroughCache} for a start that no kept one answers, and by {@link shareOwnRead}.
 * @param pid - A positive safe integer.
 * @param inputs - The platform, the file read, the runner and the query's time bound of {@link ProcessStartInputs}.
 * @returns The start with its form as prefix (`linux@<namespace>:`, `ps:`, `win:`); `undefined` when no process has the id, when the read or the query fails or runs longer than its bound, and on any other platform. Nothing here throws.
 * @example
 * await queryProcessStart(4242, {}) // => 'linux@4026531836:16362446'
 */
async function queryProcessStart(
  pid: number,
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  try {
    return await START_QUERIES[inputs.platform ?? process.platform]?.(
      pid,
      inputs,
    )
  } catch {
    // A start that cannot be read is no start; the caller then judges the process by what it has.
    return undefined
  }
}

/**
 * Says whether the last read of this process's own start still answers; called by {@link readOwnProcessStart} before it reads.
 * @param read - The last read that ended; `undefined` before the first.
 * @param nowMs - The clock's time now.
 * @returns The read while it holds: one that gave a start for good, one that failed for {@link PROCESS_START_RETRY_AFTER_FAILURE_MS}. `undefined` before the first read and once a failed one is due again.
 * @example
 * heldOwnRead({ start: 'linux:16362446', atMs: 0 }, 3_600_000) // => { start: 'linux:16362446', atMs: 0 }
 * heldOwnRead({ start: undefined, atMs: 0 }, 59_999)           // => { start: undefined, atMs: 0 }
 * heldOwnRead({ start: undefined, atMs: 0 }, 60_000)           // => undefined
 */
function heldOwnRead(
  read: OwnProcessStart['read'],
  nowMs: number,
): OwnProcessStart['read'] {
  if (read === undefined || read.start !== undefined) return read
  return nowMs - read.atMs < PROCESS_START_RETRY_AFTER_FAILURE_MS
    ? read
    : undefined
}

/**
 * Reads this process's own start, once for all callers that ask while the read is under way, and keeps the answer; called by {@link readOwnProcessStart} when no kept read answers.
 * @param kept - Where the start is kept.
 * @param now - The clock by which the read's end is noted.
 * @param inputs - The platform, the file read and the runner of {@link ProcessStartInputs}.
 * @returns The read that is under way.
 * @example
 * await shareOwnRead(ownProcessStart, monotonicNow, {}) // => 'linux@4026531836:16362446'
 */
function shareOwnRead(
  kept: OwnProcessStart,
  now: NonNullable<ProcessStartInputs['now']>,
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  kept.reading ??= queryProcessStart(process.pid, inputs).then((start) => {
    kept.read = { start, atMs: now() }
    kept.reading = undefined
    return start
  })
  return kept.reading
}

/**
 * Gives this process's own start, read once and kept; called by {@link readProcessStart} for `process.pid`, which is what {@link currentStorageOwner} records in every lock, claim and descriptor.
 * A start that was read is kept for the process. A failed read is kept for {@link PROCESS_START_RETRY_AFTER_FAILURE_MS} and then made again, so a machine whose query fails is not asked at every storage lock.
 * @param inputs - The inputs of {@link ProcessStartInputs}; `ownStart` and `now` are a test's own state and clock.
 * @returns This process's start, or `undefined` while it cannot be read. Callers that ask while a read is under way share that read.
 * @example
 * await readOwnProcessStart({}) // => 'linux@4026531836:16362446', and no second read is made for the same answer later
 */
function readOwnProcessStart(
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  const kept = inputs.ownStart ?? ownProcessStart,
    now = inputs.now ?? monotonicNow
  const held = heldOwnRead(kept.read, now())
  if (held) return Promise.resolve(held.start)
  return shareOwnRead(kept, now, inputs)
}

/**
 * Reads another process's start for a caller that may keep the starts of its sweep; called by {@link readProcessStart} for every process id but this process's own.
 * A kept start may only confirm that the process is the recorded one: it is answered when it equals `expectedStart`. Every other start is read now and kept, so a process id that was given to another process between two looks is never judged by the earlier process's start. A caller without a cache keeps nothing.
 * @param pid - A positive safe integer.
 * @param inputs - The cache, the expected start, the platform, the file read and the runner of {@link ProcessStartInputs}.
 * @returns The kept start when it equals the expected one, else the start the system names now.
 * @example
 * await readThroughCache(4242, { cache, expectedStart: 'linux@4026531836:16362446' }) // => 'linux@4026531836:16362446'
 */
async function readThroughCache(
  pid: number,
  inputs: ProcessStartInputs,
): Promise<string | undefined> {
  const cache = inputs.cache ?? new Map<number, Promise<string | undefined>>()
  const keptStart = await cache.get(pid)
  if (keptStart !== undefined && keptStart === inputs.expectedStart)
    return keptStart
  const liveStart = queryProcessStart(pid, inputs)
  cache.set(pid, liveStart)
  return liveStart
}

/**
 * Reads when the process with an id began, as a text that is compared for equality only, so that a process id that is in use again is not taken for the process a storage lock, a takeover claim, a connection descriptor or a profile marker recorded; called by {@link currentStorageOwner} for this process, by {@link isRecordedOwnerGone} for a recorded owner and by {@link readLiveWikiUpdateMarker} for the owner of a marker it verifies; the sweeps and claims between them hand it on with their caches.
 *
 * Linux reads field 22 of `/proc/<pid>/stat` and names it with the pid namespace it was read in ({@link processStartFormHere}); macOS asks `/bin/ps -o lstart=` in the C locale and UTC; Windows asks PowerShell, started by its full path under the system root, for the creation time in UTC. A query is bounded by {@link PROCESS_START_QUERY_TIMEOUT_MS}, or by the time its caller names, and by {@link PROCESS_START_QUERY_MAX_BYTES}.
 * A read of `process.pid` answers this process's own start, which is kept once the system has answered it and is not asked for again; a read that failed is kept for {@link PROCESS_START_RETRY_AFTER_FAILURE_MS} and then made again, as often as it fails ({@link readOwnProcessStart}).
 * With a `cache`, a kept start may only confirm that the process is the recorded one: it is answered when it equals `expectedStart`. Every other start is read now, so a process id that was given to another process between two looks is never judged by the earlier process's start ({@link readThroughCache}).
 *
 * @param pid - The process id a record names. One that is not a positive safe integer reaches neither a path nor a command line.
 * @param inputs - The platform, the file read, the read of the namespace link, the runner, the query's time bound, the environment that names the Windows system root and a caller's cache; the real ones when left out.
 * @returns
 * - The start with its form as prefix: `linux@<namespace>:<ticks>` (`linux:<ticks>` when the namespace cannot be read), `ps:<text>`, `win:<UTC time>`
 * - `undefined` when no process has the id, when the read or the query fails, runs too long or answers something that is no start, and on any other platform; nothing here throws
 * @example
 * await readProcessStart(4242)                                               // => 'linux@4026531836:16362446'
 * await readProcessStart(4242, { cache, expectedStart: 'linux@4026531836:16362446' })   // => 'linux@4026531836:16362446', read once for the sweep that owns `cache`
 * await readProcessStart(-1)                                                 // => undefined
 */
export async function readProcessStart(
  pid: number,
  inputs: ProcessStartInputs = {},
): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  if (pid === process.pid) return readOwnProcessStart(inputs)
  return readThroughCache(pid, inputs)
}
