import { realpath } from 'node:fs/promises'
import { basename, dirname, join, posix, win32 } from 'node:path'

import { systemErrorCode } from '../../utils/systemErrorCode'
import { trimMatchingEnds } from '../../utils/trimMatchingEnds'

import { linuxCommandLineArguments } from './linuxCommandLineArguments'
import { listProcesses, type ListedProcess } from './listProcesses'
import { windowsCommandLineArguments } from './windowsCommandLineArguments'

/** What {@link profileProcesses} matches with; each is the real one unless a test names its own. */
export type ProfileProcessInputs = {
  /** The system whose command lines are read: Windows rules on `win32`, each process's exact arguments on `linux` where they can be read, the text as `ps` prints it on every other system; `process.platform` unless a test names its own. */
  platform?: NodeJS.Platform
  /** Reads a Linux process's exact arguments; {@link linuxCommandLineArguments} unless a test names its own. */
  readArguments?: (pid: number) => Promise<string[] | undefined>
  /** Matches a profile whose real path cannot be read by the paths it is known by ({@link foldersOfProfile}) instead of failing: for a folder of the user's own profile root on a volume that resolves no path; {@link removeAbandonedProfiles} says so. */
  pathsMayNotResolve?: boolean
}

/** A profile switch as `ps` prints it on macOS and Linux: after the white space that ends the argument before it, with each prefix Chrome reads a switch by there (`--`, `-`). */
const POSIX_PROFILE_SWITCH = /(?<=\s)--?user-data-dir=/g

/** Says whether a text holds a profile switch at all ({@link POSIX_PROFILE_SWITCH}, without its state of a global search). */
const HOLDS_POSIX_PROFILE_SWITCH = new RegExp(POSIX_PROFILE_SWITCH.source)

/** Where a switch terminator (`--`) may stand in the text `ps` prints: two dashes between white space, or before the line's end. */
const POSIX_SWITCH_TERMINATOR = /(?<=\s)--(?=\s|$)/g

/** Profile switches and possible terminators in source order, so {@link namesProfileByText} never reads a growing prefix again. */
const POSIX_PROFILE_READING_PART = new RegExp(
  `${POSIX_PROFILE_SWITCH.source}|${POSIX_SWITCH_TERMINATOR.source}`,
  'g',
)

/**
 * Says whether a switch's value, read up to the end of its part of the line, is the folder: the folder alone, or the folder and the white space that ends its argument; called by {@link namesProfileByText}.
 * @param value - The text after the final profile switch through the command's end.
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
export function namesProfileByText(command: string, folder: string): boolean {
  let valueStart: number | undefined
  let hasFolderPrefix: boolean | undefined
  // A later switch replaces the value; each possible terminator still gets its own reading.
  for (const part of command.matchAll(POSIX_PROFILE_READING_PART)) {
    if (part[0] !== SWITCH_TERMINATOR) {
      valueStart = part.index + part[0].length
      hasFolderPrefix = undefined
      continue
    }
    if (valueStart === undefined || part.index - valueStart < folder.length)
      continue
    // Compare once, only after the reading contains the whole folder. A later switch starts beyond this compared span.
    hasFolderPrefix ??= command.startsWith(folder, valueStart)
    const folderEnd = valueStart + folder.length
    if (
      hasFolderPrefix &&
      (folderEnd === part.index || /\s/.test(command.charAt(folderEnd)))
    )
      return true
  }
  // The whole command is the final reading, even after earlier possible terminators.
  return (
    valueStart !== undefined && isFolderValue(command.slice(valueStart), folder)
  )
}

/** The white space Chrome trims from both ends of each argument on macOS and Linux before it reads a switch (`TrimWhitespaceASCII` with `kWhitespaceASCII`). */
const ASCII_WHITESPACE = /[\t\n\v\f\r ]/

/** The prefixes by which Chrome reads a switch on macOS and Linux (`kSwitchPrefixes`), the longest first. */
const POSIX_SWITCH_PREFIXES = ['--', '-']

/**
 * Reads the profile folder Chrome takes from its exact arguments on macOS and Linux, by `base::CommandLine`'s rules there: each argument trimmed of ASCII white space, no switch after `--`, a switch after `--` or `-` named as written up to its `=`, and the last `user-data-dir` switch deciding, also one without a value, which gives none; called by {@link namesProfileOnLinux}.
 * @param switchArguments - The arguments after the program.
 * @returns The value of the last profile switch before the terminator, `''` for one without a value; `undefined` when none stands there.
 * @example
 * profileFolderOfArguments(['--user-data-dir=/tmp/a', '--', '--user-data-dir=/tmp/b']) // => '/tmp/a'
 */
export function profileFolderOfArguments(
  switchArguments: string[],
): string | undefined {
  let profileFolder: string | undefined
  for (const written of switchArguments) {
    const argument = trimMatchingEnds(written, ASCII_WHITESPACE)
    // Chrome reads no switch after the terminator.
    if (argument === SWITCH_TERMINATOR) break
    const prefix = POSIX_SWITCH_PREFIXES.find((candidate) =>
      argument.startsWith(candidate),
    )
    if (prefix === undefined || prefix.length === argument.length) continue
    const equals = argument.indexOf('=')
    const name = argument.slice(
      prefix.length,
      equals === -1 ? undefined : equals,
    )
    // A later profile switch replaces an earlier one; without `=` its value is empty.
    if (name === PROFILE_FLAG.slice(2, -1))
      profileFolder = equals === -1 ? '' : argument.slice(equals + 1)
  }
  return profileFolder
}

/**
 * Says whether a listed Linux process gives Chrome a profile folder, by its exact arguments where they can be trusted, else by the text `ps` printed; called by {@link profileProcesses} on Linux.
 * Only a process whose text names a profile switch is read (one file of `/proc` each). Its arguments decide when they are the listed process's: they join, with spaces, to the text `ps` printed (a process id taken by another process since the listing gives another text), and the program's own argument does not hold the switch (a process that wrote its title over its arguments, as Chrome's helper processes may, keeps them all in that one). Otherwise, and when the file cannot be read, the text decides ({@link namesProfileByText}), read in every way it allows.
 * @param listed - The process as the listing gave it.
 * @param folders - The paths the profile folder is known by ({@link foldersOfProfile}).
 * @param readArguments - Reads a process's exact arguments.
 * @returns `true` when the profile switch Chrome takes names the folder: its value is the folder, also written with a trailing `/` or a `.` step.
 * @example
 * await namesProfileOnLinux({ pid: 4242, command: 'chrome --user-data-dir=/tmp/a -- --user-data-dir=/tmp/b' }, ['/tmp/b'], linuxCommandLineArguments) // => false
 */
async function namesProfileOnLinux(
  listed: ListedProcess,
  folders: string[],
  readArguments: (pid: number) => Promise<string[] | undefined>,
): Promise<boolean> {
  // A text without a profile switch names no profile; only the others are read.
  if (!HOLDS_POSIX_PROFILE_SWITCH.test(listed.command)) return false
  const commandArguments = await readArguments(listed.pid)
  const [program, ...switchArguments] = commandArguments ?? []
  const isListedProcess =
    program !== undefined &&
    commandArguments?.join(' ') === listed.command &&
    !HOLDS_POSIX_PROFILE_SWITCH.test(program)
  if (!isListedProcess)
    return folders.some((folder) => namesProfileByText(listed.command, folder))
  const profileFolder = profileFolderOfArguments(switchArguments)
  if (profileFolder === undefined || profileFolder === '') return false
  const named = posix.normalize(profileFolder).replace(/(?<=.)\/+$/, '')
  return folders.includes(named)
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
export function comparableWindowsPath(path: string): string {
  return win32.normalize(path).replace(/\\+$/, '').toLowerCase()
}

/** The prefixes by which Chrome reads a switch on Windows (`kSwitchPrefixes` of Chromium's `base::CommandLine`), the longest first. */
const WINDOWS_SWITCH_PREFIXES = ['--', '-', '/']

/** The argument after which Chrome reads no more switches (`kSwitchTerminator`). */
const SWITCH_TERMINATOR = '--'

/** The white space Chrome trims from both ends of each argument on Windows before it reads a switch: `kWhitespaceWide` of Chromium's base/strings/whitespace_constants.h, which `TrimWhitespace` uses. It differs from what `String.prototype.trim` removes: it holds NEXT LINE (U+0085) and not the byte order mark (U+FEFF). */
const CHROME_WHITESPACE_ON_WINDOWS =
  /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/

/**
 * Trims an argument as Chrome trims each one on Windows before it reads a switch or the terminator (`AppendSwitchesAndArguments` of `base::CommandLine`: `TrimWhitespace(arg, TRIM_ALL)`); called by {@link namesProfileOnWindows} for each argument.
 * @param argument - One argument as `CommandLineToArgvW` gives it.
 * @returns The argument without Chrome's white space at either end ({@link CHROME_WHITESPACE_ON_WINDOWS}).
 * @example
 * trimmedAsChrome(' --user-data-dir=C:\\x ') // => '--user-data-dir=C:\\x'
 * trimmedAsChrome('\ufeff--user-data-dir=C:\\x') // => '\ufeff--user-data-dir=C:\\x', which Chrome reads as no switch
 */
function trimmedAsChrome(argument: string): string {
  return trimMatchingEnds(argument, CHROME_WHITESPACE_ON_WINDOWS)
}

/**
 * Reads the profile folder an argument gives Chrome on Windows, as `base::CommandLine` reads a switch there: after one of its prefixes ({@link WINDOWS_SWITCH_PREFIXES}), by a name it compares in lower case, and the value after the first `=`; called by {@link namesProfileOnWindows} for each argument.
 * @param argument - One argument of the command line.
 * @returns The value of a `user-data-dir` switch, also one written `--User-Data-Dir=` or `/user-data-dir=`; `''` for the switch without a value, which clears an earlier value; `undefined` for any other argument.
 * @example
 * profileSwitchValueOnWindows('--USER-DATA-DIR=C:\\x') // => 'C:\\x'
 * profileSwitchValueOnWindows('--user-data-dir')        // => ''
 */
function profileSwitchValueOnWindows(argument: string): string | undefined {
  const prefix = WINDOWS_SWITCH_PREFIXES.find((candidate) =>
    argument.startsWith(candidate),
  )
  if (prefix === undefined) return undefined
  const switchText = argument.slice(prefix.length)
  const equals = switchText.indexOf('=')
  const switchName = equals === -1 ? switchText : switchText.slice(0, equals)
  // Chrome lowercases every switch name on Windows before it looks one up.
  if (switchName.toLowerCase() !== PROFILE_FLAG.slice(2, -1)) return undefined
  // A later switch without `=` replaces the earlier value with an empty one.
  return equals === -1 ? '' : switchText.slice(equals + 1)
}

/** The switch after which Chrome on Windows takes the rest of its command line as one loose argument (`kSingleArgument` of `base::CommandLine`), when it reads the line from its text, as its own process does (`ParseFromString` of `GetCommandLineW`). Chrome on macOS and Linux gives it no such meaning. */
const SINGLE_ARGUMENT_SWITCH = 'single-argument'

/**
 * Says whether an argument is the switch after which Chrome on Windows reads no more switches ({@link SINGLE_ARGUMENT_SWITCH}), as `IsSwitchWithKey` tells it: after one of Chrome's prefixes, the name as written, before an `=` if any; called by {@link namesProfileOnWindows} for each trimmed argument before the terminator.
 * @param argument - One trimmed argument.
 * @returns `true` for `--single-argument`, `-single-argument`, `/single-argument` and the same with `=` and a value; `false` for another case of the name (`--Single-Argument`, which Chrome reads as an ordinary switch) and for every other argument.
 * @example
 * isSingleArgumentSwitchOnWindows('--single-argument')  // => true
 * isSingleArgumentSwitchOnWindows('--Single-Argument')  // => false
 */
function isSingleArgumentSwitchOnWindows(argument: string): boolean {
  const prefix = WINDOWS_SWITCH_PREFIXES.find((candidate) =>
    argument.startsWith(candidate),
  )
  if (prefix === undefined || prefix.length === argument.length) return false
  const equals = argument.indexOf('=')
  // IsSwitchWithKey compares the name as written, before Chrome lowercases switch names.
  return (
    argument.slice(prefix.length, equals === -1 ? undefined : equals) ===
    SINGLE_ARGUMENT_SWITCH
  )
}

/**
 * Says whether a Windows command line names a profile folder as Chrome's `--user-data-dir`; called by {@link profileProcesses} on Windows.
 * The command line is split into its arguments as `CommandLineToArgvW` splits it ({@link windowsCommandLineArguments}), each argument is trimmed as Chrome trims it ({@link trimmedAsChrome}), the arguments after the program name and before a switch terminator (`--`) or the switch `--single-argument` ({@link isSingleArgumentSwitchOnWindows}) are read as Chrome reads its switches ({@link profileSwitchValueOnWindows}), and the switch's value is compared with the folder as Windows compares paths ({@link comparableWindowsPath}): the same folder written with `/`, with `.` or `..`, or in another case is the same folder.
 * @param command - The command line as Windows keeps it.
 * @param folder - The resolved profile folder.
 * @returns `true` when the last profile switch, the one Chrome takes, names this folder; `false` for a folder that only shares a prefix with it, and when a later switch names another folder.
 * @example
 * namesProfileOnWindows('chrome.exe "--User-Data-Dir=C:/USERS/a b/temp/codebook-browser-x"', 'C:\\Users\\a b\\Temp\\codebook-browser-x') // => true
 */
export function namesProfileOnWindows(
  command: string,
  folder: string,
): boolean {
  const wanted = comparableWindowsPath(folder)
  // Chrome trims each argument before it reads a switch or the terminator in it.
  const switches = windowsCommandLineArguments(command)
    .slice(1)
    .map(trimmedAsChrome)
  const end = switches.findIndex(
    (argument) =>
      argument === SWITCH_TERMINATOR ||
      isSingleArgumentSwitchOnWindows(argument),
  )
  // Chrome reads no switch after the terminator or `--single-argument`: such an argument is a loose one; of several profile switches the last one is Chrome's.
  const profileFolder = (end === -1 ? switches : switches.slice(0, end))
    .map(profileSwitchValueOnWindows)
    .findLast((value) => value !== undefined)
  return (
    profileFolder !== undefined &&
    comparableWindowsPath(profileFolder) === wanted
  )
}

/**
 * Names the paths by which a profile folder's processes may name it; called by {@link profileProcesses}.
 * @param profile - The profile folder as listed.
 * @param pathsMayNotResolve - Whether a folder whose real path cannot be read is matched all the same ({@link ProfileProcessInputs.pathsMayNotResolve}).
 * @returns The folder's real path, as Chrome and the debugger name it; for a folder that cannot be resolved, with `pathsMayNotResolve`, its listed path and, when its parent resolves, its name below the parent's real path (`/tmp` resolves to `/private/tmp` on macOS), so a process that names either is matched.
 * @throws The error of `realpath` without `pathsMayNotResolve`, and for a folder that is gone.
 * @example
 * await foldersOfProfile('/tmp/codebook-browser-a', false) // => ['/private/tmp/codebook-browser-a'] on macOS
 * await foldersOfProfile('R:\\codebook-browser-a', true)   // => ['R:\\codebook-browser-a'] on a RAM disk that resolves no path
 */
export async function foldersOfProfile(
  profile: string,
  pathsMayNotResolve: boolean,
): Promise<string[]> {
  try {
    return [await realpath(profile)]
  } catch (error) {
    // A folder that is gone has no processes to look for.
    if (!pathsMayNotResolve || systemErrorCode(error) === 'ENOENT') throw error
    const realParent = await realpath(dirname(profile)).catch(() => undefined)
    return realParent === undefined
      ? [profile]
      : [...new Set([profile, join(realParent, basename(profile))])]
  }
}

/**
 * Observes only the exact fresh Chrome profile during owned launch/cleanup; never signals other processes. Called by {@link HostBrowser} for its own profile, and by {@link removeAbandonedProfiles} for each candidate folder with the one listing of its sweep.
 * On Windows the command line is read argument by argument and the profile path is compared as Windows compares paths ({@link namesProfileOnWindows}): a path that holds a space is written in quotes there, and the same folder may be written with `/` or in another case. On Linux each candidate's exact arguments decide, read from `/proc` ({@link namesProfileOnLinux}); on macOS, and on Linux for a process whose arguments cannot be read or trusted, the last profile switch before a switch terminator in the text `ps` printed decides, read in every way the text allows, and its value must be the folder, exactly ({@link namesProfileByText}). On both, Chrome reads no switch after a terminator (on Windows also none after `--single-argument`), and of several profile switches before it the last one counts, as Chrome takes it.
 * @param profile - The profile folder; it is resolved first, so a folder that is gone rejects, and so does one that cannot be resolved unless `inputs.pathsMayNotResolve` says to match it by the paths it is known by.
 * @param processes - The processes to match, as {@link listProcesses} listed them; listed now when left out.
 * @param inputs - The system whose command lines are read, the reader of Linux arguments and the rule for a folder that cannot be resolved ({@link ProfileProcessInputs}); the real ones when left out.
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
  const folders = await foldersOfProfile(
    profile,
    inputs.pathsMayNotResolve === true,
  )
  const platform = inputs.platform ?? process.platform
  // Windows keeps a command line as one text with quoted arguments, and compares paths without regard to case or separator.
  if (platform === 'win32')
    return listed.filter(({ command }) =>
      folders.some((folder) => namesProfileOnWindows(command, folder)),
    )
  if (platform !== 'linux')
    return listed.filter(({ command }) =>
      folders.some((folder) => namesProfileByText(command, folder)),
    )
  // Linux keeps each process's arguments apart in /proc.
  const readArguments = inputs.readArguments ?? linuxCommandLineArguments
  const named = await Promise.all(
    listed.map((candidate) =>
      namesProfileOnLinux(candidate, folders, readArguments),
    ),
  )
  return listed.filter((_, index) => named[index])
}
