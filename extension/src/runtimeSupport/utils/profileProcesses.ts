import { realpath } from 'node:fs/promises'
import { win32 } from 'node:path'

import { listProcesses, type ListedProcess } from './listProcesses'
import { windowsCommandLineArguments } from './windowsCommandLineArguments'

/** What {@link profileProcesses} matches with; each is the real one unless a test names its own. */
export type ProfileProcessInputs = {
  /** The system whose command lines are read: Windows rules on `win32`, the text as `ps` prints it on every other system; `process.platform` unless a test names its own. */
  platform?: NodeJS.Platform
}

/**
 * Says whether a command line `ps` printed names a profile argument as a whole argument; called by {@link profileProcesses} on macOS and Linux, where `ps` prints the arguments joined by spaces, without quotes.
 * @param command - The command line as `ps` printed it.
 * @param argument - The whole `--user-data-dir=<folder>` argument.
 * @returns `true` when the argument is followed by a space or ends the line; `false` for a profile that only shares a prefix with it.
 * @example
 * namesArgumentByText('chrome --user-data-dir=/tmp/codebook-browser-a --headless=new', '--user-data-dir=/tmp/codebook-browser-a') // => true
 * namesArgumentByText('chrome --user-data-dir=/tmp/codebook-browser-ab', '--user-data-dir=/tmp/codebook-browser-a')                  // => false
 */
function namesArgumentByText(command: string, argument: string): boolean {
  const offset = command.indexOf(argument)
  const following = command[offset + argument.length]
  // Prefix-sharing profiles do not establish ownership.
  return offset >= 0 && (!following || following === ' ')
}

/** The flag by which Chrome is given its profile folder. */
const PROFILE_FLAG = '--user-data-dir='

/**
 * Gives a Windows path in the form Windows compares two paths by, for {@link namesProfileOnWindows}: separators as backslashes, `.` and `..` resolved, no trailing separator, and in one case, since Windows file names ignore case.
 * @param path - A folder's path as a command line or `realpath` gives it.
 * @returns The comparable form.
 * @example
 * comparableWindowsPath('C:/Users/A B/AppData/Local/Temp/./codebook-browser-x\\') // => 'c:\\users\\a b\\appdata\\local\\temp\\codebook-browser-x'
 */
function comparableWindowsPath(path: string): string {
  return win32.normalize(path).replace(/\\+$/, '').toLowerCase()
}

/** The prefixes by which Chrome reads a switch on Windows (`kSwitchPrefixes` of Chromium's `base::CommandLine`), the longest first. */
const WINDOWS_SWITCH_PREFIXES = ['--', '-', '/']

/** The argument after which Chrome reads no more switches (`kSwitchTerminator`). */
const SWITCH_TERMINATOR = '--'

/**
 * Reads the profile folder an argument gives Chrome on Windows, as `base::CommandLine` reads a switch there: after one of its prefixes ({@link WINDOWS_SWITCH_PREFIXES}), by a name it compares in lower case, and the value after the first `=`; called by {@link namesProfileOnWindows} for each argument.
 * @param argument - One argument of the command line.
 * @returns The value of a `user-data-dir` switch, also one written `--User-Data-Dir=` or `/user-data-dir=`; `undefined` for any other argument and for the switch without a value.
 * @example
 * profileSwitchValueOnWindows('--USER-DATA-DIR=C:\\x') // => 'C:\\x'
 * profileSwitchValueOnWindows('--user-data-dir')        // => undefined
 */
function profileSwitchValueOnWindows(argument: string): string | undefined {
  const prefix = WINDOWS_SWITCH_PREFIXES.find((candidate) =>
    argument.startsWith(candidate),
  )
  if (prefix === undefined) return undefined
  const switchText = argument.slice(prefix.length)
  const equals = switchText.indexOf('=')
  // Chrome lowercases every switch name on Windows before it looks one up.
  return equals > 0 &&
    switchText.slice(0, equals).toLowerCase() === PROFILE_FLAG.slice(2, -1)
    ? switchText.slice(equals + 1)
    : undefined
}

/**
 * Says whether a Windows command line names a profile folder as Chrome's `--user-data-dir`; called by {@link profileProcesses} on Windows.
 * The command line is split into its arguments as `CommandLineToArgvW` splits it ({@link windowsCommandLineArguments}), the arguments after the program name and before a switch terminator (`--`) are read as Chrome reads its switches ({@link profileSwitchValueOnWindows}), and the switch's value is compared with the folder as Windows compares paths ({@link comparableWindowsPath}): the same folder written with `/`, with `.` or `..`, or in another case is the same folder.
 * @param command - The command line as Windows keeps it.
 * @param folder - The resolved profile folder.
 * @returns `true` when an argument is the profile switch with this folder; `false` for a folder that only shares a prefix with it.
 * @example
 * namesProfileOnWindows('chrome.exe "--User-Data-Dir=C:/USERS/a b/temp/codebook-browser-x"', 'C:\\Users\\a b\\Temp\\codebook-browser-x') // => true
 */
function namesProfileOnWindows(command: string, folder: string): boolean {
  const wanted = comparableWindowsPath(folder)
  const switches = windowsCommandLineArguments(command).slice(1)
  const terminator = switches.indexOf(SWITCH_TERMINATOR)
  // Chrome reads no switch after the terminator: such an argument is a loose one.
  return (terminator === -1 ? switches : switches.slice(0, terminator)).some(
    (argument) => {
      const value = profileSwitchValueOnWindows(argument)
      return value !== undefined && comparableWindowsPath(value) === wanted
    },
  )
}

/**
 * Observes only the exact fresh Chrome profile during owned launch/cleanup; never signals other processes. Called by {@link HostBrowser} for its own profile, and by {@link removeAbandonedProfiles} for each candidate folder with the one listing of its sweep.
 * On Windows the command line is read argument by argument and the profile path is compared as Windows compares paths ({@link namesProfileOnWindows}): a path that holds a space is written in quotes there, and the same folder may be written with `/` or in another case. On macOS and Linux the argument is found, exactly, in the text `ps` printed.
 * @param profile - The profile folder; it is resolved first, so a folder that is gone rejects.
 * @param processes - The processes to match, as {@link listProcesses} listed them; listed now when left out.
 * @param inputs - The system whose command lines are read ({@link ProfileProcessInputs}); this one when left out.
 * @returns The processes whose command line names the folder as `--user-data-dir`; a profile that only shares a prefix with it does not count.
 * @throws When the folder cannot be resolved, or the processes cannot be listed.
 * @example
 * await profileProcesses('/tmp/codebook-browser-unique') // => [{ pid: 4242, command: '… --user-data-dir=/private/tmp/codebook-browser-unique --headless=new' }]
 * await profileProcesses('/tmp/codebook-browser-unique', listing) // matched against a listing the caller made
 * await profileProcesses('C:\\Users\\a b\\AppData\\Local\\Temp\\codebook-browser-x', listing, { platform: 'win32' }) // => [{ pid: 4242, command: '"C:\\…\\chrome.exe" "--user-data-dir=C:\\Users\\a b\\AppData\\Local\\Temp\\codebook-browser-x" …' }]
 */
export async function profileProcesses(
  profile: string,
  processes?: ListedProcess[],
  inputs: ProfileProcessInputs = {},
): Promise<ListedProcess[]> {
  const listed = processes ?? (await listProcesses())
  // Chrome/js-debug resolve /tmp symlinks before spawning on macOS.
  const folder = await realpath(profile)
  // Windows keeps a command line as one text with quoted arguments, and compares paths without regard to case or separator.
  if ((inputs.platform ?? process.platform) === 'win32')
    return listed.filter(({ command }) =>
      namesProfileOnWindows(command, folder),
    )
  const argument = `${PROFILE_FLAG}${folder}`
  return listed.filter(({ command }) => namesArgumentByText(command, argument))
}
