import { realpath } from 'node:fs/promises'
import { win32 } from 'node:path'

import { listProcesses, type ListedProcess } from './listProcesses'
import { windowsCommandLineArguments } from './windowsCommandLineArguments'

/** What {@link profileProcesses} matches with; each is the real one unless a test names its own. */
export type ProfileProcessInputs = {
  /** The system whose command lines are read: Windows rules on `win32`, the text as `ps` prints it on every other system; `process.platform` unless a test names its own. */
  platform?: NodeJS.Platform
}

/** The profile switch as `ps` prints it on macOS and Linux, with each prefix Chrome reads a switch by there (`--`, `-`), after the space that separates it from the argument before it. */
const POSIX_PROFILE_SWITCHES = [' --user-data-dir=', ' -user-data-dir=']

/**
 * Says whether a command line `ps` printed gives Chrome a profile folder; called by {@link profileProcesses} on macOS and Linux, where `ps` prints the arguments joined by spaces, without quotes.
 * Chrome takes the last of several profile switches (`base::CommandLine` replaces a switch's value by a later one), so the last switch in the text decides, and its value must be the folder followed by a space or the line's end. The text cannot tell a switch terminator (`--`) from text inside an argument, so none is looked for: a switch after it counts, which leaves the folder in place rather than taking it for unused.
 * @param command - The command line as `ps` printed it.
 * @param folder - The resolved profile folder.
 * @returns `true` when the last profile switch names this folder; `false` for a folder that only shares a prefix with it, and when a later switch names another folder.
 * @example
 * namesProfileByText('chrome --user-data-dir=/tmp/codebook-browser-ab --user-data-dir=/tmp/codebook-browser-a --headless', '/tmp/codebook-browser-a') // => true
 * namesProfileByText('chrome --user-data-dir=/tmp/codebook-browser-a --user-data-dir=/tmp/other', '/tmp/codebook-browser-a')                        // => false
 */
function namesProfileByText(command: string, folder: string): boolean {
  const lastSwitch = POSIX_PROFILE_SWITCHES.map((profileSwitch) => ({
    at: command.lastIndexOf(profileSwitch),
    length: profileSwitch.length,
  })).reduce((latest, candidate) =>
    candidate.at > latest.at ? candidate : latest,
  )
  if (lastSwitch.at === -1) return false
  const value = command.slice(lastSwitch.at + lastSwitch.length)
  // Prefix-sharing profiles do not establish ownership.
  return value === folder || value.startsWith(`${folder} `)
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
 * @returns `true` when the last profile switch, the one Chrome takes, names this folder; `false` for a folder that only shares a prefix with it, and when a later switch names another folder.
 * @example
 * namesProfileOnWindows('chrome.exe "--User-Data-Dir=C:/USERS/a b/temp/codebook-browser-x"', 'C:\\Users\\a b\\Temp\\codebook-browser-x') // => true
 */
function namesProfileOnWindows(command: string, folder: string): boolean {
  const wanted = comparableWindowsPath(folder)
  const switches = windowsCommandLineArguments(command).slice(1)
  const terminator = switches.indexOf(SWITCH_TERMINATOR)
  // Chrome reads no switch after the terminator: such an argument is a loose one; of several profile switches the last one is Chrome's.
  const profileFolder = (
    terminator === -1 ? switches : switches.slice(0, terminator)
  )
    .map(profileSwitchValueOnWindows)
    .findLast((value) => value !== undefined)
  return (
    profileFolder !== undefined &&
    comparableWindowsPath(profileFolder) === wanted
  )
}

/**
 * Observes only the exact fresh Chrome profile during owned launch/cleanup; never signals other processes. Called by {@link HostBrowser} for its own profile, and by {@link removeAbandonedProfiles} for each candidate folder with the one listing of its sweep.
 * On Windows the command line is read argument by argument and the profile path is compared as Windows compares paths ({@link namesProfileOnWindows}): a path that holds a space is written in quotes there, and the same folder may be written with `/` or in another case. On macOS and Linux the last profile switch in the text `ps` printed decides, and its value must be the folder, exactly ({@link namesProfileByText}). On both, of several profile switches the last one counts, as Chrome takes it.
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
  return listed.filter(({ command }) => namesProfileByText(command, folder))
}
