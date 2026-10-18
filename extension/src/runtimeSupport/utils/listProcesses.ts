import {
  PROCESS_LISTING_MAX_BYTES,
  PROCESS_LISTING_TIMEOUT_MS,
} from '../../constants'
import { isProgramFile } from '../../utils/isProgramFile'
import {
  runBoundedQuery,
  type BoundedQueryOptions,
  type BoundedQueryRunner,
} from '../../utils/runBoundedQuery'
import { systemErrorCode } from '../../utils/systemErrorCode'
import {
  windowsPowerShellPath,
  type SystemRootEnvironment,
} from '../../utils/windowsPowerShellPath'

/** One running process as the system's listing names it: its id and its whole command line with every argument. */
export type ListedProcess = { pid: number; command: string }

/** What {@link listProcesses} lists with; each is the real one unless a test names its own. */
export type ProcessListingInputs = {
  /** The system whose listing is used: PowerShell on `win32`, `ps` on every other system. */
  platform?: NodeJS.Platform
  /** Runs the listing without a shell and answers what it printed; it rejects when the listing fails, runs too long or prints too much. {@link runBoundedQuery} unless a test names its own. */
  run?: BoundedQueryRunner
  /** How long the listing may run, in milliseconds; {@link PROCESS_LISTING_TIMEOUT_MS} unless a test shortens it. */
  timeoutMs?: number
  /** The environment the Windows system root is read from (`SystemRoot`, then `windir`), under which PowerShell is started by its full path ({@link windowsPowerShellPath}); `process.env` unless a test names its own. */
  environment?: SystemRootEnvironment
  /** Where `ps` may lie on macOS and Linux, tried in this order; {@link PS_PROGRAMS} unless a test names a stand-in of its own. */
  psPrograms?: readonly string[]
  /** Says whether a path is a program file this user may run; {@link isProgramFile} unless a test names its own. */
  isProgramFile?: (path: string) => Promise<boolean>
}

/** Where `ps` lies on macOS and Linux: `/bin/ps`, and `/usr/bin/ps` on a system whose `/bin` has none. It is started by one of these absolute paths, never looked up in the search path or the current folder. */
const PS_PROGRAMS = ['/bin/ps', '/usr/bin/ps']

/** The listing of one system: the command that prints every process on a line of its own, and the reader of such a line. */
type ProcessListingForm = {
  file: string
  listingArguments: string[]
  /** Reads one printed line; `undefined` for a line that names no process id or no command line. */
  processOfLine: (line: string) => ListedProcess | undefined
}

/** `ps` on macOS and Linux: every process of every user (`-ax`), the command line at its whole width (`-ww`), as `<pid> <command line>`. Its program is named by {@link listingFormOf}, by an absolute path. */
const UNIX_LISTING: Omit<ProcessListingForm, 'file'> = {
  listingArguments: ['-axww', '-o', 'pid=,command='],
  processOfLine: (line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!match?.[1] || !match[2]) return undefined
    return { pid: Number(match[1]), command: match[2] }
  },
}

/**
 * What PowerShell runs on Windows: every `Win32_Process` with its id and its command line, one a line as `<pid> <command line in Base64 of its UTF-8 bytes>`.
 * The command line is printed in Base64, so that the answer is ASCII whatever code page the console has, and a command line with a line break stays one line.
 * A process whose command line Windows does not show to this user (a system process, a process of another user) is printed with an empty one. A failed query ends PowerShell with an error (`-ErrorAction Stop`), never with a partial list.
 */
const WINDOWS_LISTING_COMMAND =
  "Get-CimInstance -ClassName Win32_Process -Property ProcessId,CommandLine -ErrorAction Stop | ForEach-Object { '{0} {1}' -f $_.ProcessId, [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.CommandLine)) }"

/** PowerShell on Windows, which has no `ps`: {@link WINDOWS_LISTING_COMMAND}, without a profile and without a prompt. Its program is named by {@link listingFormOf}, by its full path under the system root. */
const WINDOWS_LISTING: Omit<ProcessListingForm, 'file'> = {
  listingArguments: [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_LISTING_COMMAND,
  ],
  processOfLine: (line) => {
    // A process without a readable command line has no Base64 text after its id and is left out.
    const match = /^(\d+) ([A-Za-z0-9+/]+={0,2})$/.exec(line.trim())
    if (!match?.[1] || !match[2]) return undefined
    return {
      pid: Number(match[1]),
      command: Buffer.from(match[2], 'base64').toString('utf8'),
    }
  },
}

/**
 * Chooses the listing of a system; called by {@link listProcesses}.
 * @param platform - The system whose listing is used.
 * @param inputs - Where the Windows system root is read from, and where `ps` may lie on other systems with the check of its file ({@link ProcessListingInputs}).
 * @returns PowerShell on Windows, started by its full path under the system root ({@link windowsPowerShellPath}, the same lookup as the start query of {@link readProcessStart}), so that no `powershell.exe` of another folder is started in its place; on every other system `ps` by the first of its absolute paths that holds it ({@link PS_PROGRAMS}), never one searched for in the search path or the current folder.
 * @throws When the program's folder is unknown: on Windows when neither `SystemRoot` nor `windir` names a drive-letter folder, elsewhere when no path of `ps` holds it. The listing is refused then and no program is started, since a program searched for in other folders could be another one of that name.
 * @example
 * (await listingFormOf('darwin', {})).file                         // => '/bin/ps'
 * (await listingFormOf('win32', { environment: { SystemRoot: 'C:\\Windows' } })).file // => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 */
async function listingFormOf(
  platform: NodeJS.Platform,
  inputs: ProcessListingInputs,
): Promise<ProcessListingForm> {
  if (platform !== 'win32') {
    const isProgram = inputs.isProgramFile ?? isProgramFile
    for (const candidate of inputs.psPrograms ?? PS_PROGRAMS)
      if (await isProgram(candidate))
        return { ...UNIX_LISTING, file: candidate }
    throw new Error(
      `The process listing was not started: no ps lies at ${(inputs.psPrograms ?? PS_PROGRAMS).join(' or ')}, and Codebook starts it only from there.`,
    )
  }
  const file = windowsPowerShellPath(inputs.environment)
  // Without a system root PowerShell's folder is unknown; no other folder is searched for it.
  if (file === undefined)
    throw new Error(
      'The process listing was not started: neither SystemRoot nor windir names the Windows folder, and Codebook starts Windows PowerShell only from it.',
    )
  return { ...WINDOWS_LISTING, file }
}

/** Says whether a failed listing was ended because it ran longer than its time bound: Node.js marks the error of a child it ended itself. @example isEndedAtTimeBound(Object.assign(new Error('Command failed: ps'), { killed: true, signal: 'SIGKILL' })) // => true */
function isEndedAtTimeBound(failure: unknown): boolean {
  return (
    failure instanceof Error && 'killed' in failure && failure.killed === true
  )
}

/**
 * Words a listing that was ended at one of its bounds, so that a run that waited for the listing says what happened and not only "Command failed"; called by {@link printedListing} with what its runner rejected with.
 * @param failure - What the runner rejected with.
 * @param file - The command that was run.
 * @param bounds - The bounds it was run with.
 * @returns
 * - A listing that printed more than its output limit: an error with that sentence
 * - A listing that was ended at its time bound: an error with that sentence
 * - Any other failure (the command is missing, it ended with an error): the failure as it is
 * @example
 * listingFailure(endedAtItsTimeBound, 'ps', bounds) // => Error: The process listing (ps) did not answer within 10000 ms and was ended.
 */
function listingFailure(
  failure: unknown,
  file: string,
  bounds: BoundedQueryOptions,
): unknown {
  // A child that printed too much is ended by Node.js too, so the output limit is asked first.
  if (systemErrorCode(failure) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return new Error(
      `The process listing (${file}) printed more than ${bounds.maxBuffer} bytes and was ended.`,
      { cause: failure },
    )
  if (isEndedAtTimeBound(failure))
    return new Error(
      `The process listing (${file}) did not answer within ${bounds.timeout} ms and was ended.`,
      { cause: failure },
    )
  return failure
}

/**
 * Runs one system's listing within its bounds and reads what it printed; the body of {@link listProcesses} once the system, the runner and the bounds are chosen.
 * @param listing - The command and the line reader of the system.
 * @param run - The runner.
 * @param bounds - The bounds the listing is run with.
 * @returns Every process the listing printed with a command line, in its order.
 * @throws What the runner rejects with, worded by {@link listingFailure} for a listing that was ended at a bound.
 * @example
 * await printedListing({ ...UNIX_LISTING, file: '/bin/ps' }, runBoundedQuery, bounds) // => [{ pid: 1, command: '/sbin/launchd' }, …]
 */
async function printedListing(
  listing: ProcessListingForm,
  run: BoundedQueryRunner,
  bounds: BoundedQueryOptions,
): Promise<ListedProcess[]> {
  try {
    const { stdout } = await run(listing.file, listing.listingArguments, bounds)
    return stdout
      .split('\n')
      .flatMap((line) => listing.processOfLine(line) ?? [])
  } catch (failure) {
    throw listingFailure(failure, listing.file, bounds)
  }
}

/**
 * Lists every process of this machine with its whole command line, by one `ps -axww` on macOS and Linux and one PowerShell query on Windows, each started by an absolute path (`ps` from `/bin` or `/usr/bin`, PowerShell under the system root, {@link windowsPowerShellPath}); called by {@link profileProcesses} for one profile and once per sweep by {@link removeAbandonedProfiles}, which matches every candidate folder against the same listing.
 * The listing is bounded: it is ended with a signal it cannot ignore after {@link PROCESS_LISTING_TIMEOUT_MS}, and when it prints more than {@link PROCESS_LISTING_MAX_BYTES}. Its input is closed ({@link runBoundedQuery}).
 * @param inputs - The platform, the runner, the time bound, the environment that names the Windows system root, and the paths and file check of `ps`, of {@link ProcessListingInputs}; the real ones when left out.
 * @returns Every process the listing printed with a command line, in its order; a line that names no process id or no command line is left out.
 * @throws What running the listing throws, for example on a machine without the command; for a listing that ran too long or printed too much, an error that says so ({@link listingFailure}); on Windows without a system root, the refusal of {@link listingFormOf}, before any program is started. A caller that removes by the listing removes nothing then.
 * @example
 * await listProcesses() // => [{ pid: 1, command: '/sbin/launchd' }, { pid: 4242, command: '/Applications/Google Chrome --user-data-dir=/tmp/codebook-browser-a1b2c3' }, …]
 * await listProcesses({ platform: 'win32' }) // => [{ pid: 4242, command: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=C:\\Temp\\codebook-browser-a1b2c3' }, …]
 */
export async function listProcesses(
  inputs: ProcessListingInputs = {},
): Promise<ListedProcess[]> {
  return printedListing(
    await listingFormOf(inputs.platform ?? process.platform, inputs),
    inputs.run ?? runBoundedQuery,
    {
      timeout: inputs.timeoutMs ?? PROCESS_LISTING_TIMEOUT_MS,
      maxBuffer: PROCESS_LISTING_MAX_BYTES,
      killSignal: 'SIGKILL',
      windowsHide: true,
    },
  )
}
