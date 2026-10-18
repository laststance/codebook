import { realpath } from 'node:fs/promises'
import { win32 } from 'node:path'

import { listProcesses, type ListedProcess } from './listProcesses'
import { windowsCommandLineArguments } from './windowsCommandLineArguments'

/** What {@link profileProcesses} matches with; each is the real one unless a test names its own. */
export type ProfileProcessInputs = {
  /** The system whose command lines are read: Windows rules on `win32`, the text as `ps` prints it on every other system; `process.platform` unless a test names its own. */
  platform?: NodeJS.Platform
}

/** A profile switch as `ps` prints it on macOS and Linux: after the white space that ends the argument before it, with each prefix Chrome reads a switch by there (`--`, `-`). */
const POSIX_PROFILE_SWITCH = /(?<=\s)--?user-data-dir=/g

/** Where a switch terminator (`--`) may stand in the text `ps` prints: two dashes between white space, or before the line's end. */
const POSIX_SWITCH_TERMINATOR = /(?<=\s)--(?=\s|$)/g

/**
 * Reads the value of the last profile switch in a part of a command line `ps` printed; called by {@link namesProfileByText} for each reading of the line.
 * @param text - The part of the line Chrome would read switches in.
 * @returns The text after the last switch, up to the part's end; `undefined` when the part holds no profile switch.
 * @example
 * lastProfileValueIn('chrome --user-data-dir=/tmp/a --user-data-dir=/tmp/b --headless') // => '/tmp/b --headless'
 */
function lastProfileValueIn(text: string): string | undefined {
  const last = [...text.matchAll(POSIX_PROFILE_SWITCH)].at(-1)
  return last === undefined
    ? undefined
    : text.slice(last.index + last[0].length)
}

/**
 * Says whether a switch's value, read up to the end of its part of the line, is the folder: the folder alone, or the folder and the white space that ends its argument; called by {@link namesProfileByText}.
 * @param value - The text after the switch ({@link lastProfileValueIn}).
 * @param folder - The resolved profile folder.
 * @returns `false` for a folder that only shares a prefix with it.
 * @example
 * isFolderValue('/tmp/codebook-browser-a --headless', '/tmp/codebook-browser-a') // => true
 * isFolderValue('/tmp/codebook-browser-ab', '/tmp/codebook-browser-a')           // => false
 */
function isFolderValue(value: string, folder: string): boolean {
  return (
    value.startsWith(folder) && /^(?:\s|$)/.test(value.slice(folder.length))
  )
}

/**
 * Says whether a command line `ps` printed gives Chrome a profile folder; called by {@link profileProcesses} on macOS and Linux, where `ps` prints the arguments joined by spaces, without quotes.
 * Chrome reads switches only before a switch terminator (`--`), and of several profile switches before it takes the last (`base::CommandLine` replaces a switch's value by a later one). The text cannot tell a `--` argument from two dashes inside an argument, so each place a terminator may stand gives one reading, up to that place, and the whole line gives another: the folder counts as named when the last profile switch of any reading names it. A reading too many keeps a folder in place; a reading too few would let the sweep take a live profile for unused.
 * @param command - The command line as `ps` printed it.
 * @param folder - The resolved profile folder.
 * @returns `true` when the last profile switch of a reading names this folder; `false` for a folder that only shares a prefix with it, and when every reading's last switch names another folder.
 * @example
 * namesProfileByText('chrome --user-data-dir=/tmp/codebook-browser-a -- --user-data-dir=/tmp/other', '/tmp/codebook-browser-a')      // => true
 * namesProfileByText('chrome --user-data-dir=/tmp/codebook-browser-ab --user-data-dir=/tmp/codebook-browser-a --headless', '/tmp/codebook-browser-a') // => true
 * namesProfileByText('chrome --user-data-dir=/tmp/codebook-browser-a --user-data-dir=/tmp/other', '/tmp/codebook-browser-a')        // => false
 */
function namesProfileByText(command: string, folder: string): boolean {
  const readingEnds = [
    ...[...command.matchAll(POSIX_SWITCH_TERMINATOR)].map(
      (terminator) => terminator.index,
    ),
    command.length,
  ]
  // Each reading ends where a terminator may stand; the last one is the whole line.
  return readingEnds.some((end) => {
    const value = lastProfileValueIn(command.slice(0, end))
    return value !== undefined && isFolderValue(value, folder)
  })
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

/** The white space Chrome trims from both ends of each argument on Windows before it reads a switch: `kWhitespaceWide` of Chromium's base/strings/whitespace_constants.h, which `TrimWhitespace` uses. It differs from what `String.prototype.trim` removes: it holds NEXT LINE (U+0085) and not the byte order mark (U+FEFF). */
const CHROME_WHITESPACE_AT_ENDS_ON_WINDOWS =
  /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g

/**
 * Trims an argument as Chrome trims each one on Windows before it reads a switch or the terminator (`AppendSwitchesAndArguments` of `base::CommandLine`: `TrimWhitespace(arg, TRIM_ALL)`); called by {@link namesProfileOnWindows} for each argument.
 * @param argument - One argument as `CommandLineToArgvW` gives it.
 * @returns The argument without Chrome's white space at either end ({@link CHROME_WHITESPACE_AT_ENDS_ON_WINDOWS}).
 * @example
 * trimmedAsChrome(' --user-data-dir=C:\\x ') // => '--user-data-dir=C:\\x'
 * trimmedAsChrome('\ufeff--user-data-dir=C:\\x') // => '\ufeff--user-data-dir=C:\\x', which Chrome reads as no switch
 */
function trimmedAsChrome(argument: string): string {
  return argument.replace(CHROME_WHITESPACE_AT_ENDS_ON_WINDOWS, '')
}

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
 * The command line is split into its arguments as `CommandLineToArgvW` splits it ({@link windowsCommandLineArguments}), each argument is trimmed as Chrome trims it ({@link trimmedAsChrome}), the arguments after the program name and before a switch terminator (`--`) are read as Chrome reads its switches ({@link profileSwitchValueOnWindows}), and the switch's value is compared with the folder as Windows compares paths ({@link comparableWindowsPath}): the same folder written with `/`, with `.` or `..`, or in another case is the same folder.
 * @param command - The command line as Windows keeps it.
 * @param folder - The resolved profile folder.
 * @returns `true` when the last profile switch, the one Chrome takes, names this folder; `false` for a folder that only shares a prefix with it, and when a later switch names another folder.
 * @example
 * namesProfileOnWindows('chrome.exe "--User-Data-Dir=C:/USERS/a b/temp/codebook-browser-x"', 'C:\\Users\\a b\\Temp\\codebook-browser-x') // => true
 */
function namesProfileOnWindows(command: string, folder: string): boolean {
  const wanted = comparableWindowsPath(folder)
  // Chrome trims each argument before it reads a switch or the terminator in it.
  const switches = windowsCommandLineArguments(command)
    .slice(1)
    .map(trimmedAsChrome)
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
 * On Windows the command line is read argument by argument and the profile path is compared as Windows compares paths ({@link namesProfileOnWindows}): a path that holds a space is written in quotes there, and the same folder may be written with `/` or in another case. On macOS and Linux the last profile switch before a switch terminator in the text `ps` printed decides, read in every way the text allows, and its value must be the folder, exactly ({@link namesProfileByText}). On both, Chrome reads no switch after a terminator, and of several profile switches before it the last one counts, as Chrome takes it.
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
