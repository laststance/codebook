import {
  MANAGED_PROFILE_PREFIX,
  PROCESS_LISTING_MAX_BYTES,
  PROCESS_LISTING_TIMEOUT_MS,
} from '../../constants'
import { psProgramPath } from '../../utils/psProgramPath'
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
export type ListedProcess = {
  pid: number
  command: string
  /** The id of the process's parent; present only in a listing asked with {@link ProcessListingInputs.withParentPids}. */
  parentPid?: number
}

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
  /** The effective user id whose processes the listing keeps on macOS and Linux; this process's own (`process.geteuid()`) unless a test names its own. */
  userId?: number
  /**
   * Keeps, on Windows, a process of another logon session whose owner cannot be confirmed as this user (its owner, or this user's own identifier, cannot be read), for a caller that must count every process that may be this user's: the sweep of abandoned profile folders ({@link removeAbandonedProfiles}) holds a folder such a process names. Left out (the run's attach and close, {@link profileProcesses}), such a process is not listed, so it is never taken for this user's browser. macOS and Linux confirm every owner by its user id and list no such process.
   */
  keepsUnconfirmedOwners?: boolean
  /** Lists each process with its parent's id ({@link ListedProcess.parentPid}), for the orphan sweep that must tell a browser's helpers from a stranger that only names its folder (ER18); left out, the listing is the one every other caller reads. */
  withParentPids?: boolean
}

/** The listing of one system: the command that prints every process on a line of its own, and the reader of what it printed. */
type ProcessListingForm = {
  file: string
  listingArguments: string[]
  /** Reads what the listing printed; a line that names no process id or no command line, or a process the listing leaves out, gives none. */
  processesOf: (printed: string) => ListedProcess[]
}

/** A line `ps` prints for {@link unixListing}: the process id, the effective user id and the command line. The pattern captures text in every group of a line it matches. */
const UNIX_PROCESS_LINE = /^\s*(\d+)\s+(\d+)\s+(.+)$/

/** A line `ps` prints for {@link unixListing} with parents: the process id, the parent's id, the effective user id and the command line. */
const UNIX_PROCESS_LINE_WITH_PARENT = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/

/**
 * Says whether a listed process is one of the user whose processes the `ps` listing reads; called by {@link unixProcessOfLine}.
 * @param ownerId - The effective user id of the process, as `ps` printed it.
 * @param userId - The effective user id whose processes are read; `undefined` reads every user's.
 * @returns `true` for a process of that user, and for every process when no user is named.
 * @example
 * isProcessOfUser(502, 501)       // => false
 * isProcessOfUser(502, undefined) // => true
 */
function isProcessOfUser(ownerId: number, userId: number | undefined): boolean {
  return userId === undefined || ownerId === userId
}

/**
 * Reads one line `ps` printed for {@link unixListing} as a process of one user; called by the reader of that listing for every line.
 * @param line - One printed line, `<pid> <uid> <command line>`.
 * @param userId - The effective user id whose processes are read; `undefined` reads every user's.
 * @returns The process with its id and command line; `undefined` for a line that names no process id, user id or command line, and for a process of another user.
 * @example
 * unixProcessOfLine(' 4242   501 /usr/bin/chrome --user-data-dir=/tmp/x', 501) // => { pid: 4242, command: '/usr/bin/chrome --user-data-dir=/tmp/x' }
 * unixProcessOfLine(' 5150   502 /usr/bin/sleep 600', 501)                     // => undefined
 */
function unixProcessOfLine(
  line: string,
  userId: number | undefined,
  withParentPids = false,
): ListedProcess | undefined {
  // A line the pattern matches has text in every group, so its command line stands for the whole match.
  const [, pid, second, third, fourth] = withParentPids
    ? (UNIX_PROCESS_LINE_WITH_PARENT.exec(line) ?? [])
    : (UNIX_PROCESS_LINE.exec(line) ?? [])
  // With parents the columns are pid, ppid, uid, command; without, pid, uid, command.
  const ownerId = withParentPids ? third : second
  const command = withParentPids ? fourth : third
  // A process of another user is not listed.
  if (!command || !isProcessOfUser(Number(ownerId), userId)) return undefined
  return {
    pid: Number(pid),
    command,
    ...(withParentPids && { parentPid: Number(second) }),
  }
}

/**
 * Gives the form of `ps` on macOS and Linux: every process of every user (`-ax`), with its effective user id and the command line at its whole width (`-ww`), as `<pid> <uid> <command line>`, of which the lines of one user are read; called by {@link listingFormOf}, which names its program by an absolute path.
 * Why one user's: a run matches its browser's profile against the listing ({@link profileProcesses}), and on a machine shared with other users a process of another user that names the run's profile folder (its path is in every user's listing) would be taken for the run's browser: with a debugging port it fails the attach, and one that never exits holds the close until its bound. The browser a run starts is this user's process.
 * @param userId - The effective user id whose processes are read; `undefined` reads every user's, for a system that names no user id.
 * @returns The listing's arguments and the reader of what it printed.
 * @example
 * unixListing(501).processesOf(' 4242   501 /usr/bin/chrome --user-data-dir=/tmp/x\n 5150   502 /usr/bin/sleep 600\n') // => [{ pid: 4242, command: '/usr/bin/chrome --user-data-dir=/tmp/x' }]
 */
function unixListing(
  userId: number | undefined,
  withParentPids = false,
): Omit<ProcessListingForm, 'file'> {
  return {
    listingArguments: [
      '-axww',
      '-o',
      withParentPids ? 'pid=,ppid=,uid=,command=' : 'pid=,uid=,command=',
    ],
    processesOf: (printed) =>
      printed
        .split('\n')
        .flatMap(
          (line) => unixProcessOfLine(line, userId, withParentPids) ?? [],
        ),
  }
}

/**
 * What PowerShell runs on Windows: first a line `editor <session> <user>` with the logon session PowerShell itself runs in, which is the editor's, and the security identifier (SID) of the user it runs as; then every `Win32_Process` that may hold a run's profile, one a line as `<pid> <session> <owner> <command line, percent-encoded>`. An identifier that cannot be read is printed as `?`.
 * Browser profiles are per user, and a browser of this user may run in another session of this user (a remote session whose editor ended), so every session is listed: the processes of the editor's session all, and those of every other session whose command line names a Codebook profile folder (the start of every managed profile folder's name, {@link MANAGED_PROFILE_PREFIX}, which PowerShell's `-like` compares without case, as Windows compares paths), each with the SID of its owner, which `Invoke-CimMethod` reads by the `GetOwnerSid` method of `Win32_Process` (it answers `Sid` with `ReturnValue` 0; Windows lets a user read the owner of the user's own processes without elevation). Only these few pay for that call, one after another; a process of another session that names no Codebook profile folder is not printed, since every caller matches only such a folder ({@link profileProcesses} for a managed run's profile, {@link removeAbandonedProfiles} for the folders of that name). The profile switch alone (`user-data-dir`) would not do: most Chromium-based apps pass it (Electron and WebView2 children), so on a machine shared by several sessions hundreds of owner calls would pass the listing's bound (Cycle 0047 row 235). Whose a process is, is judged by the listing's reader ({@link windowsOwnerOf}), so that a process of another user that names a run's profile folder is never taken for the run's browser ({@link unixListing} says why for macOS and Linux). The session is read from PowerShell's own process (`$PID`) and given to the filter by the format operator, in single quotes, so no double quote has to pass the command line.
 * The command line is percent-encoded by `[uri]::EscapeDataString` (its UTF-8 bytes, RFC 3986), so that the answer is ASCII whatever code page the console has, and a command line with a line break stays one line.
 * The query uses only what PowerShell's Constrained Language mode allows, which AppLocker or App Control for Business put every PowerShell of a managed machine in: cmdlets (`Invoke-CimMethod` among them), `ForEach-Object`, `if`, `try`/`catch`, `-like`, the format operator, a property of a returned object, the automatic variable `$PID`, and the methods of the allowed types `[uri]` and `[string]` (about_Language_Modes); `[Convert]` and `[Text.Encoding]`, which the query used before, are no allowed types there, and every listing would fail.
 * A process whose command line Windows does not show to this user (a system process, a process of another user), or whose command line cannot be encoded (longer than .NET Framework encodes in one call), is printed with an empty one. An owner whose call fails (access denied, a process that ended meanwhile) is printed as `?`. A failed listing ends PowerShell with an error (`-ErrorAction Stop`), never with a partial list.
 */
const WINDOWS_LISTING_COMMAND = [
  "$editor = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = {0}' -f $PID) -Property SessionId -ErrorAction Stop",
  "try { $user = (Invoke-CimMethod -InputObject $editor -MethodName GetOwnerSid -ErrorAction Stop).Sid } catch { $user = '' }",
  "if (-not $user) { $user = '?' }",
  "'editor {0} {1}' -f $editor.SessionId, $user",
  `Get-CimInstance -ClassName Win32_Process -Property ProcessId,SessionId,CommandLine -ErrorAction Stop | ForEach-Object { $process = $_; if ($process.SessionId -eq $editor.SessionId -or $process.CommandLine -like '*${MANAGED_PROFILE_PREFIX}*') { $owner = '?'; if ($process.SessionId -ne $editor.SessionId) { try { $sid = (Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop).Sid } catch { $sid = '' }; if ($sid) { $owner = $sid } }; try { $commandLine = [uri]::EscapeDataString([string]$process.CommandLine) } catch { $commandLine = '' }; '{0} {1} {2} {3}' -f $process.ProcessId, $process.SessionId, $owner, $commandLine } }`,
].join('; ')

/** {@link WINDOWS_LISTING_COMMAND} with each process's parent: the first token of a process line is `<pid>/<parent pid>`. */
const WINDOWS_LISTING_WITH_PARENTS_COMMAND = WINDOWS_LISTING_COMMAND.replace(
  '-Property ProcessId,SessionId,CommandLine',
  '-Property ProcessId,ParentProcessId,SessionId,CommandLine',
)
  .replace("'{0} {1} {2} {3}' -f", "'{0}/{4} {1} {2} {3}' -f")
  .replace(
    '$owner, $commandLine }',
    '$owner, $commandLine, $process.ParentProcessId }',
  )

/** The first line {@link WINDOWS_LISTING_COMMAND} prints: the editor's logon session and the SID of the user PowerShell runs as. */
const WINDOWS_EDITOR_LINE = /^editor (\d+) (\S+)$/

/** A process line {@link WINDOWS_LISTING_COMMAND} prints: its id, its logon session, the SID of its owner and its percent-encoded command line. A process without a readable command line has no text after its owner and does not match. */
const WINDOWS_PROCESS_LINE = /^(\d+)(?:\/(\d+))? (\d+) (\S+) (\S+)$/

/** How {@link WINDOWS_LISTING_COMMAND} prints a SID it could not read. */
const UNREAD_OWNER = '?'

/** The characters a percent-encoded command line consists of: what `[uri]::EscapeDataString` leaves as it is (RFC 3986's unreserved characters, and the few more RFC 2396 left on an older .NET Framework) and `%` with two hexadecimal digits. */
const PERCENT_ENCODED_TEXT = /^[A-Za-z0-9\-._~!*'()%]+$/

/**
 * Decodes a command line the Windows listing printed percent-encoded; called by {@link windowsLineOf} for every process line.
 * @param encoded - The text after the process's owner; `undefined` for a line that is no process line.
 * @returns The command line; `undefined` for a text that is no percent-encoding of UTF-8, and for no text.
 * @example
 * decodedCommandLine('%22c%3A%5Cnode.exe%22') // => '"c:\\node.exe"'
 */
function decodedCommandLine(encoded: string | undefined): string | undefined {
  if (encoded === undefined || !PERCENT_ENCODED_TEXT.test(encoded))
    return undefined
  try {
    return decodeURIComponent(encoded)
  } catch {
    // A malformed escape is no command line the query printed.
    return undefined
  }
}

/** A logon session and a SID as {@link WINDOWS_LISTING_COMMAND} prints them, the SID {@link UNREAD_OWNER} when it could not be read. */
type WindowsOwnership = { session: string; sid: string }

/**
 * Gives a logon session and a SID that a line of the Windows listing names, as one ownership; called by {@link windowsEditorOf} for the editor's line and by {@link windowsLineOf} for every process line.
 * @param session - The session the line names; `undefined` for a line its pattern does not match.
 * @param sid - The SID the line names, {@link UNREAD_OWNER} when it could not be read; `undefined` for a line its pattern does not match.
 * @returns The ownership; `undefined` when either is missing.
 * @example
 * windowsOwnershipOf('1', 'S-1-5-21-1-1001') // => { session: '1', sid: 'S-1-5-21-1-1001' }
 * windowsOwnershipOf(undefined, undefined)   // => undefined
 */
function windowsOwnershipOf(
  session: string | undefined,
  sid: string | undefined,
): WindowsOwnership | undefined {
  return session && sid ? { session, sid } : undefined
}

/**
 * Judges whose a process of the Windows listing is; called by {@link windowsProcessOfLine} for every process line.
 * A process of the editor's own logon session counts as this user's without its owner being read (Cycle 0047 row 37: there a process started with other credentials is listed too, and its command line is shown only to an administrator). A process of another session is this user's when its owner's SID is the editor's (Cycle 0047 row 196: a browser of this user in another remote session).
 * @param process - The process's session and the SID of its owner.
 * @param editor - The editor's session and the SID of the user PowerShell runs as.
 * @returns
 * - `'own'` for a process of the editor's session, and for one of another session whose owner is this user
 * - `'unconfirmed'` for a process of another session when its owner's SID or this user's own cannot be read: it may be this user's
 * - `'another-user'` for a process of another session whose owner is another user
 * @example
 * windowsOwnerOf({ session: '2', sid: 'S-1-5-21-1-1001' }, { session: '1', sid: 'S-1-5-21-1-1001' }) // => 'own'
 * windowsOwnerOf({ session: '2', sid: '?' }, { session: '1', sid: 'S-1-5-21-1-1001' })              // => 'unconfirmed'
 */
function windowsOwnerOf(
  process: WindowsOwnership,
  editor: WindowsOwnership,
): 'own' | 'unconfirmed' | 'another-user' {
  if (process.session === editor.session) return 'own'
  // Either SID that could not be read leaves the process possibly this user's.
  if (process.sid === UNREAD_OWNER || editor.sid === UNREAD_OWNER)
    return 'unconfirmed'
  return process.sid === editor.sid ? 'own' : 'another-user'
}

/**
 * Says whether the Windows listing lists a process whose owner was judged ({@link windowsOwnerOf}); called by {@link windowsProcessOfLine}.
 * @param owner - Whose the process is.
 * @param keepsUnconfirmedOwners - Whether a process whose owner cannot be confirmed is kept ({@link ProcessListingInputs.keepsUnconfirmedOwners}).
 * @returns `true` for this user's process, and for one that may be this user's when the caller counts it; `false` for another user's process, which is never listed.
 * @example
 * isListedOwner('unconfirmed', false) // => false
 * isListedOwner('unconfirmed', true)  // => true
 */
function isListedOwner(
  owner: ReturnType<typeof windowsOwnerOf>,
  keepsUnconfirmedOwners: boolean,
): boolean {
  return owner === 'own' || (owner === 'unconfirmed' && keepsUnconfirmedOwners)
}

/**
 * Reads the line {@link WINDOWS_LISTING_COMMAND} prints first, the editor's logon session and the SID of the user PowerShell runs as; called by {@link windowsProcessesOf}, which judges every process line by it.
 * @param lines - The printed lines, trimmed.
 * @returns The editor's session and SID, from the first line that is the editor's.
 * @throws When no printed line is the editor's: no process could be judged then.
 * @example
 * windowsEditorOf(['editor 1 S-1-5-21-1-1001', '5150 2 S-1-5-21-1-1001 %22c%3A%5Cchrome.exe%22']) // => { session: '1', sid: 'S-1-5-21-1-1001' }
 */
function windowsEditorOf(lines: string[]): WindowsOwnership {
  const [, session, sid] =
    lines
      .map((line) => WINDOWS_EDITOR_LINE.exec(line))
      .find((match) => match !== null) ?? []
  const editor = windowsOwnershipOf(session, sid)
  if (!editor)
    throw new Error(
      'The process listing (PowerShell) printed no line of its own logon session, so no process could be judged as this user’s.',
    )
  return editor
}

/** A process line of the Windows listing as {@link windowsLineOf} reads it: the process id, its session and owner, and its decoded command line. */
type WindowsProcessLine = {
  pid: number
  parentPid?: number
  ownership: WindowsOwnership
  command: string
}

/**
 * Reads one process line {@link WINDOWS_LISTING_COMMAND} printed, `<pid> <session> <owner> <command line, percent-encoded>`; called by {@link windowsProcessOfLine}.
 * @param line - One printed line, trimmed.
 * @returns The process id, its session and owner and its decoded command line; `undefined` for a line that is no process line, and for one whose command line is empty or no percent-encoding of UTF-8.
 * @example
 * windowsLineOf('5150 2 ? %22c%3A%5Cchrome.exe%22') // => { pid: 5150, ownership: { session: '2', sid: '?' }, command: '"c:\\chrome.exe"' }
 * windowsLineOf('4 0 ?')                            // => undefined
 */
function windowsLineOf(line: string): WindowsProcessLine | undefined {
  // A line the pattern matches has text in every group, so its session and owner stand for the whole match.
  const [, pid, parentPid, session, sid, encodedCommand] =
    WINDOWS_PROCESS_LINE.exec(line) ?? []
  const ownership = windowsOwnershipOf(session, sid)
  const command = decodedCommandLine(encodedCommand)
  if (!ownership || !command) return undefined
  return {
    pid: Number(pid),
    ownership,
    command,
    ...(parentPid !== undefined && { parentPid: Number(parentPid) }),
  }
}

/**
 * Reads one line the Windows listing printed as a process this user's listing holds; called by {@link windowsProcessesOf} for every line.
 * @param line - One printed line, trimmed.
 * @param editor - The editor's session and SID ({@link windowsEditorOf}).
 * @param keepsUnconfirmedOwners - Whether a process whose owner cannot be confirmed is kept ({@link ProcessListingInputs.keepsUnconfirmedOwners}).
 * @returns The process with its id and command line; `undefined` for a line that is no process line with a readable command line, for another user's process, and for one whose owner cannot be confirmed unless the caller keeps it.
 * @example
 * windowsProcessOfLine('5150 2 S-1-5-21-1-1001 %22c%3A%5Cchrome.exe%22', { session: '1', sid: 'S-1-5-21-1-1001' }, false) // => { pid: 5150, command: '"c:\\chrome.exe"' }
 * windowsProcessOfLine('6006 2 ? %22c%3A%5Cchrome.exe%22', { session: '1', sid: 'S-1-5-21-1-1001' }, false)               // => undefined
 */
function windowsProcessOfLine(
  line: string,
  editor: WindowsOwnership,
  keepsUnconfirmedOwners: boolean,
): ListedProcess | undefined {
  const read = windowsLineOf(line)
  // Another user's process is never listed; one that may be this user's only for a caller that counts it.
  if (
    !read ||
    !isListedOwner(
      windowsOwnerOf(read.ownership, editor),
      keepsUnconfirmedOwners,
    )
  )
    return undefined
  return {
    pid: read.pid,
    command: read.command,
    ...(read.parentPid !== undefined && { parentPid: read.parentPid }),
  }
}

/**
 * Reads what {@link WINDOWS_LISTING_COMMAND} printed as the processes of this user ({@link windowsOwnerOf}) with a readable command line, and with `keepsUnconfirmedOwners` those that may be this user's; the reader of {@link windowsListing}.
 * @param printed - What PowerShell printed.
 * @param keepsUnconfirmedOwners - Whether a process whose owner cannot be confirmed is kept ({@link ProcessListingInputs.keepsUnconfirmedOwners}).
 * @returns The listed processes, in the order PowerShell printed them; a process of another user is never listed.
 * @throws When no printed line is the editor's ({@link windowsEditorOf}).
 * @example
 * windowsProcessesOf('editor 1 S-1-5-21-1-1001\r\n5150 2 S-1-5-21-1-1001 %22c%3A%5Cchrome.exe%22\r\n6006 2 ? %22c%3A%5Cchrome.exe%22\r\n', false) // => [{ pid: 5150, command: '"c:\\chrome.exe"' }]
 */
function windowsProcessesOf(
  printed: string,
  keepsUnconfirmedOwners: boolean,
): ListedProcess[] {
  const lines = printed.split('\n').map((line) => line.trim())
  const editor = windowsEditorOf(lines)
  return lines.flatMap(
    (line) => windowsProcessOfLine(line, editor, keepsUnconfirmedOwners) ?? [],
  )
}

/**
 * Gives PowerShell on Windows, which has no `ps`: {@link WINDOWS_LISTING_COMMAND}, without a profile and without a prompt, and the reader of what it printed; called by {@link listingFormOf}, which names its program by its full path under the system root.
 * @param keepsUnconfirmedOwners - Whether a process whose owner cannot be confirmed is kept ({@link ProcessListingInputs.keepsUnconfirmedOwners}).
 * @returns The listing's arguments and its reader ({@link windowsProcessesOf}), which lists the processes of this user ({@link windowsOwnerOf}) with a readable command line, and with `keepsUnconfirmedOwners` those that may be this user's; a process of another user is never listed.
 * @throws From the reader, when the listing printed no line of the editor's session ({@link windowsEditorOf}): no process could be judged then.
 * @example
 * windowsListing(false).processesOf('editor 1 S-1-5-21-1-1001\r\n5150 2 S-1-5-21-1-1001 %22c%3A%5Cchrome.exe%22\r\n6006 2 ? %22c%3A%5Cchrome.exe%22\r\n') // => [{ pid: 5150, command: '"c:\\chrome.exe"' }]
 */
function windowsListing(
  keepsUnconfirmedOwners: boolean,
  withParentPids = false,
): Omit<ProcessListingForm, 'file'> {
  return {
    listingArguments: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      withParentPids
        ? WINDOWS_LISTING_WITH_PARENTS_COMMAND
        : WINDOWS_LISTING_COMMAND,
    ],
    processesOf: (printed) =>
      windowsProcessesOf(printed, keepsUnconfirmedOwners),
  }
}

/**
 * Chooses the listing of a system; called by {@link listProcesses}.
 * @param platform - The system whose listing is used.
 * @param inputs - Where the Windows system root is read from, and where `ps` may lie on other systems with the check of its file ({@link ProcessListingInputs}).
 * @returns PowerShell on Windows, started by its full path under the system root ({@link windowsPowerShellPath}, the same lookup as the start query of {@link readProcessStart}), so that no `powershell.exe` of another folder is started in its place; on every other system `ps` by the first of its absolute paths that holds it ({@link psProgramPath}), never one searched for in the search path or the current folder.
 * @throws When the program's folder is unknown: on Windows when neither `SystemRoot` nor `windir` names a drive-letter folder, elsewhere when no path of `ps` holds it. The listing is refused then and no program is started, since a program searched for in other folders could be another one of that name.
 * @example
 * (await listingFormOf('darwin', {})).file                         // => '/bin/ps'
 * (await listingFormOf('win32', { environment: { SystemRoot: 'C:\\Windows' } })).file // => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 */
async function listingFormOf(
  platform: NodeJS.Platform,
  inputs: ProcessListingInputs,
): Promise<ProcessListingForm> {
  // ps is started from its absolute paths only, by the same lookup as the process group checks of the inspectors.
  if (platform !== 'win32')
    return {
      ...unixListing(
        inputs.userId ?? process.geteuid?.(),
        inputs.withParentPids === true,
      ),
      file: await psProgramPath('The process listing', inputs),
    }
  const file = windowsPowerShellPath(inputs.environment)
  // Without a system root PowerShell's folder is unknown; no other folder is searched for it.
  if (file === undefined)
    throw new Error(
      'The process listing was not started: neither SystemRoot nor windir names the Windows folder, and Codebook starts Windows PowerShell only from it.',
    )
  return {
    ...windowsListing(
      inputs.keepsUnconfirmedOwners === true,
      inputs.withParentPids === true,
    ),
    file,
  }
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
 * @param listing - The command and the reader of the system.
 * @param run - The runner.
 * @param bounds - The bounds the listing is run with.
 * @returns Every process the listing printed with a command line, in its order.
 * @throws What the runner rejects with, worded by {@link listingFailure} for a listing that was ended at a bound; what the reader throws for an answer it cannot judge.
 * @example
 * await printedListing({ ...unixListing(501), file: '/bin/ps' }, runBoundedQuery, bounds) // => [{ pid: 512, command: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder' }, …], the processes of the user 501
 */
async function printedListing(
  listing: ProcessListingForm,
  run: BoundedQueryRunner,
  bounds: BoundedQueryOptions,
): Promise<ListedProcess[]> {
  try {
    const { stdout } = await run(listing.file, listing.listingArguments, bounds)
    return listing.processesOf(stdout)
  } catch (failure) {
    throw listingFailure(failure, listing.file, bounds)
  }
}

/**
 * Lists the processes of this user with their whole command lines, by one `ps -axww` on macOS and Linux, read for this user's effective user id ({@link unixListing}), and one PowerShell query on Windows for every logon session, judged by the owner of each process ({@link WINDOWS_LISTING_COMMAND}, {@link windowsOwnerOf}), each started by an absolute path (`ps` from `/bin` or `/usr/bin`, PowerShell under the system root, {@link windowsPowerShellPath}); called by {@link profileProcesses} for one profile and once per sweep by {@link removeAbandonedProfiles}, which matches every candidate folder against the same listing.
 * The listing is bounded: it is ended with a signal it cannot ignore after {@link PROCESS_LISTING_TIMEOUT_MS}, and when it prints more than {@link PROCESS_LISTING_MAX_BYTES}. Its input is closed ({@link runBoundedQuery}).
 * @param inputs - The platform, the runner, the time bound, the environment that names the Windows system root, the paths and file check of `ps`, the user id and whether a Windows process whose owner cannot be confirmed is kept, of {@link ProcessListingInputs}; the real ones when left out.
 * @returns Every process of this user the listing printed with a command line, in its order (on Windows: every process of the editor's session, and those of the user's other sessions that name a Codebook profile folder), and with `keepsUnconfirmedOwners` also a Windows process of another session whose owner cannot be confirmed; a line that names no process id or no command line, or a process of another user, is left out.
 * @throws What running the listing throws; for a listing that ran too long or printed too much, an error that says so ({@link listingFailure}); the refusal of {@link listingFormOf}, before any program is started, on Windows when neither SystemRoot nor windir names the Windows folder, and on macOS and Linux when no `ps` lies at `/bin/ps` or `/usr/bin/ps`. A caller that removes by the listing removes nothing then.
 * @example
 * await listProcesses() // => [{ pid: 512, command: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder' }, { pid: 4242, command: '/Applications/Google Chrome --user-data-dir=/tmp/codebook-browser-a1b2c3' }, …], without the system's processes (launchd is root's)
 * await listProcesses({ platform: 'win32' }) // => [{ pid: 4242, command: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=C:\\Temp\\codebook-browser-a1b2c3' }, …]
 * await listProcesses({ platform: 'win32', keepsUnconfirmedOwners: true }) // the same, and a browser of another session whose owner could not be read
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
