import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  PROCESS_LISTING_MAX_BYTES,
  PROCESS_LISTING_TIMEOUT_MS,
} from '../../constants'

/** One running process as the system's listing names it: its id and its whole command line with every argument. */
export type ListedProcess = { pid: number; command: string }

/** What a process listing is run with: its two bounds, a signal no process can ignore, and no console window on Windows. */
type ProcessListingOptions = {
  timeout: number
  maxBuffer: number
  killSignal: 'SIGKILL'
  windowsHide: true
}

/** What {@link listProcesses} lists with; each is the real one unless a test names its own. */
export type ProcessListingInputs = {
  /** The system whose listing is used: PowerShell on `win32`, `ps` on every other system. */
  platform?: NodeJS.Platform
  /** Runs the listing without a shell and answers what it printed; it rejects when the listing fails, runs too long or prints too much. */
  run?: (
    file: string,
    listingArguments: string[],
    options: ProcessListingOptions,
  ) => Promise<{ stdout: string }>
  /** How long the listing may run, in milliseconds; {@link PROCESS_LISTING_TIMEOUT_MS} unless a test shortens it. */
  timeoutMs?: number
}

/** The listing of one system: the command that prints every process on a line of its own, and the reader of such a line. */
type ProcessListingForm = {
  file: string
  listingArguments: string[]
  /** Reads one printed line; `undefined` for a line that names no process id or no command line. */
  processOfLine: (line: string) => ListedProcess | undefined
}

/** `ps` on macOS and Linux: every process of every user (`-ax`), the command line at its whole width (`-ww`), as `<pid> <command line>`. */
const UNIX_LISTING: ProcessListingForm = {
  file: 'ps',
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

/** PowerShell on Windows, which has no `ps`: {@link WINDOWS_LISTING_COMMAND}, without a profile and without a prompt. */
const WINDOWS_LISTING: ProcessListingForm = {
  file: 'powershell.exe',
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

/** Runs one process listing without a shell and closes its input, which neither listing reads and which, left open, can keep PowerShell waiting. @example await runListing('ps', ['-axww', '-o', 'pid=,command='], bounds) // => { stdout: '    1 /sbin/launchd\n…', stderr: '' } */
const runListing: NonNullable<ProcessListingInputs['run']> = (
  file,
  listingArguments,
  options,
) => {
  const listing = promisify(execFile)(file, listingArguments, options)
  listing.child.stdin?.end()
  return listing
}

/**
 * Words a listing that was ended at one of its bounds, so that a run that waited for the listing says what happened and not only "Command failed"; called by {@link listProcesses} with what its runner rejected with.
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
  bounds: ProcessListingOptions,
): unknown {
  if (!(failure instanceof Error)) return failure
  if ('code' in failure && failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return new Error(
      `The process listing (${file}) printed more than ${bounds.maxBuffer} bytes and was ended.`,
      { cause: failure },
    )
  if ('killed' in failure && failure.killed === true)
    return new Error(
      `The process listing (${file}) did not answer within ${bounds.timeout} ms and was ended.`,
      { cause: failure },
    )
  return failure
}

/**
 * Lists every process of this machine with its whole command line, by one `ps -axww` on macOS and Linux and one PowerShell query on Windows; called by {@link profileProcesses} for one profile and once per sweep by {@link removeAbandonedProfiles}, which matches every candidate folder against the same listing.
 * The listing is bounded: it is ended with a signal it cannot ignore after {@link PROCESS_LISTING_TIMEOUT_MS}, and when it prints more than {@link PROCESS_LISTING_MAX_BYTES}. Its input is closed.
 * @param inputs - The platform, the runner and the time bound of {@link ProcessListingInputs}; the real ones when left out.
 * @returns Every process the listing printed with a command line, in its order; a line that names no process id or no command line is left out.
 * @throws What running the listing throws, for example on a machine without the command; for a listing that ran too long or printed too much, an error that says so ({@link listingFailure}). A caller that removes by the listing removes nothing then.
 * @example
 * await listProcesses() // => [{ pid: 1, command: '/sbin/launchd' }, { pid: 4242, command: '/Applications/Google Chrome --user-data-dir=/tmp/codebook-browser-a1b2c3' }, …]
 * await listProcesses({ platform: 'win32' }) // => [{ pid: 4242, command: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=C:\\Temp\\codebook-browser-a1b2c3' }, …]
 */
export async function listProcesses(
  inputs: ProcessListingInputs = {},
): Promise<ListedProcess[]> {
  const listing =
    (inputs.platform ?? process.platform) === 'win32'
      ? WINDOWS_LISTING
      : UNIX_LISTING
  const bounds: ProcessListingOptions = {
    timeout: inputs.timeoutMs ?? PROCESS_LISTING_TIMEOUT_MS,
    maxBuffer: PROCESS_LISTING_MAX_BYTES,
    killSignal: 'SIGKILL',
    windowsHide: true,
  }
  try {
    const { stdout } = await (inputs.run ?? runListing)(
      listing.file,
      listing.listingArguments,
      bounds,
    )
    return stdout
      .split('\n')
      .flatMap((line) => listing.processOfLine(line) ?? [])
  } catch (failure) {
    throw listingFailure(failure, listing.file, bounds)
  }
}
