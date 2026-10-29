import { posix } from 'node:path'

import { linuxCommandLineArguments } from './linuxCommandLineArguments'
import type { ListedProcess } from './listProcesses'
import {
  comparableWindowsPath,
  foldersOfProfile,
  namesProfileByText,
  namesProfileOnWindows,
  profileFolderOfArguments,
  type ProfileProcessInputs,
} from './profileProcesses'
import { windowsCommandLineArguments } from './windowsCommandLineArguments'

/** Where a switch terminator (`--`) may stand in the text `ps` prints: two dashes between white space, or before the line's end. */
const TERMINATOR_IN_TEXT = /(?<=\s)--(?=\s|$)/

/**
 * Proves a macOS process by the text `ps` printed: it starts with the recorded executable, and the profile switch Chrome takes names the folder, with no possible switch terminator before it.
 * Why strict: the text cannot tell a `--` argument from two dashes inside one, so any `--` ahead of the switch makes the proof fail (the loose reading of {@link profileProcesses} keeps the folder instead).
 * @param command - The command line as `ps` printed it.
 * @param executable - The executable the launch recorded.
 * @param folders - The paths the profile folder is known by.
 * @returns `true` only for an exact proof.
 * @example
 * isProvenByText('/opt/chrome/chrome --user-data-dir=/tmp/a --headless', '/opt/chrome/chrome', ['/tmp/a']) // => true
 * isProvenByText('/opt/chrome/chrome -- --user-data-dir=/tmp/a', '/opt/chrome/chrome', ['/tmp/a'])        // => false
 */
function isProvenByText(
  command: string,
  executable: string,
  folders: string[],
): boolean {
  if (command !== executable && !command.startsWith(`${executable} `))
    return false
  const rest = command.slice(executable.length)
  const terminator = TERMINATOR_IN_TEXT.exec(rest)
  const beforeTerminator =
    terminator === null ? rest : rest.slice(0, terminator.index)
  return folders.some((folder) =>
    namesProfileByText(`${executable}${beforeTerminator}`, folder),
  )
}

/**
 * Proves a Linux process by its exact `/proc/<pid>/cmdline`: the arguments are the listed process's own, `argv[0]` is the recorded executable and the profile switch Chrome takes (before any `--`) is the folder.
 * @param listed - The process as the listing gave it.
 * @param executable - The executable the launch recorded.
 * @param folders - The paths the profile folder is known by.
 * @param readArguments - Reads a process's exact arguments.
 * @returns `true` only for an exact proof; `false` when the arguments cannot be read or are no longer the listed process's.
 * @example
 * await isProvenOnLinux({ pid: 4242, command: '/opt/chrome/chrome --user-data-dir=/tmp/a' }, '/opt/chrome/chrome', ['/tmp/a'], linuxCommandLineArguments) // => true
 */
async function isProvenOnLinux(
  listed: ListedProcess,
  executable: string,
  folders: string[],
  readArguments: (pid: number) => Promise<string[] | undefined>,
): Promise<boolean> {
  const commandArguments = await readArguments(listed.pid)
  // A pid taken by another process since the listing gives other arguments.
  if (!commandArguments || commandArguments.join(' ') !== listed.command)
    return false
  const [program, ...switchArguments] = commandArguments
  if (program !== executable) return false
  const profileFolder = profileFolderOfArguments(switchArguments)
  if (profileFolder === undefined || profileFolder === '') return false
  return folders.includes(
    posix.normalize(profileFolder).replace(/(?<=.)\/+$/, ''),
  )
}

/**
 * Proves a Windows process by its parsed command line: the program is the recorded executable (compared as Windows compares paths) and the profile switch Chrome takes names the folder.
 * @param command - The command line as Windows keeps it.
 * @param executable - The executable the launch recorded.
 * @param folders - The paths the profile folder is known by.
 * @returns `true` only for an exact proof.
 * @example
 * isProvenOnWindows('"C:\\chrome\\chrome.exe" --user-data-dir=C:\\p', 'C:\\chrome\\chrome.exe', ['C:\\p']) // => true
 */
function isProvenOnWindows(
  command: string,
  executable: string,
  folders: string[],
): boolean {
  const [program] = windowsCommandLineArguments(command)
  if (
    program === undefined ||
    comparableWindowsPath(program) !== comparableWindowsPath(executable)
  )
    return false
  return folders.some((folder) => namesProfileOnWindows(command, folder))
}

/**
 * Keeps, of the processes that name an owned profile folder, only those proven to be the browser Codebook spawned for it; the only processes the orphan sweep may signal (ER18).
 * Called by {@link removeAbandonedProfiles} right before it signals. The proof is stricter than the keep-the-folder reading of {@link profileProcesses}: the program itself (`argv[0]`, the command path, the parsed Windows program) equals the executable recorded in the owned-browser marker, and the exact `--user-data-dir` argument before any `--` equals the folder. A process that merely prints the folder in its arguments (an editor, a shell, a `-- --user-data-dir=…` argument) is not proven.
 * @param profile - The profile folder.
 * @param executable - The executable recorded at launch.
 * @param processes - The processes of a fresh listing.
 * @param inputs - The system and the Linux argument reader ({@link ProfileProcessInputs}); the real ones when left out.
 * @returns The proven processes.
 * @throws When the folder cannot be resolved.
 * @example
 * await ownedBrowserProcesses('/tmp/codebook-browser-a1b2c3', '/opt/chrome/chrome', listing) // => [{ pid: 4242, command: '/opt/chrome/chrome --user-data-dir=/private/tmp/codebook-browser-a1b2c3 …' }]
 */
export async function ownedBrowserProcesses(
  profile: string,
  executable: string,
  processes: ListedProcess[],
  inputs: ProfileProcessInputs = {},
): Promise<ListedProcess[]> {
  const folders = await foldersOfProfile(
    profile,
    inputs.pathsMayNotResolve === true,
  )
  const platform = inputs.platform ?? process.platform
  if (platform === 'win32')
    return processes.filter(({ command }) =>
      isProvenOnWindows(command, executable, folders),
    )
  if (platform !== 'linux')
    return processes.filter(({ command }) =>
      isProvenByText(command, executable, folders),
    )
  const readArguments = inputs.readArguments ?? linuxCommandLineArguments
  const proven = await Promise.all(
    processes.map((listed) =>
      isProvenOnLinux(listed, executable, folders, readArguments),
    ),
  )
  return processes.filter((_, index) => proven[index])
}

/** The processes that name an owned profile folder, told apart by what the orphan sweep may do with them. */
export type OwnedBrowserProcessSet = {
  /** The browser's main process: its pid is the marker's recorded pid, its program the recorded executable, and it names the folder. `undefined` when no listed process is proven so. */
  main: ListedProcess | undefined
  /** Processes that name the folder and descend from {@link OwnedBrowserProcessSet.main} (Chrome's helpers); never signalled by themselves, they end with their parent's group. */
  helpers: ListedProcess[]
  /** Processes that name the folder and are neither: the folder stays and nothing is signalled while one exists. */
  foreign: ListedProcess[]
}

/**
 * Walks a process's parents through the listing and says whether one of them is the given process; called by {@link ownedBrowserProcessSet} for each process naming the folder.
 * @param listed - The process whose ancestry is read.
 * @param ancestorPid - The pid looked for.
 * @param parentOf - The parent of each listed pid.
 * @returns `true` when `ancestorPid` is among the process's ancestors; a cycle or a missing parent ends the walk with `false`.
 * @example
 * descendsFrom({ pid: 12, parentPid: 11, command: '' }, 10, new Map([[11, 10]])) // => true
 */
function descendsFrom(
  listed: ListedProcess,
  ancestorPid: number,
  parentOf: ReadonlyMap<number, number | undefined>,
): boolean {
  const seen = new Set<number>([listed.pid])
  let parent = listed.parentPid
  // Climb until the ancestor is met, the chain ends or it loops.
  while (parent !== undefined && !seen.has(parent)) {
    if (parent === ancestorPid) return true
    seen.add(parent)
    parent = parentOf.get(parent)
  }
  return false
}

/**
 * Sorts the processes that name an owned profile folder into the browser's main process, its helpers and strangers; the proof the orphan sweep needs before it signals anything (ER18).
 * Called by the orphan sweep ({@link removeAbandonedProfiles}). The main process is proven only when its pid equals the pid the launch recorded AND its program is the recorded executable AND it names the folder exactly ({@link ownedBrowserProcesses}); on macOS the text `ps` prints cannot tell `--user-data-dir=<P>` from `--user-data-dir=<P> backup`, so the pid is what ties the process to this folder. A helper is a process that names the folder and has the main process among its ancestors in the listing.
 * @param profile - The profile folder.
 * @param marker - The executable and pid recorded in the owned-browser marker.
 * @param listing - The whole fresh listing, with parent ids, for the ancestry.
 * @param named - The processes of `listing` that name the folder.
 * @param inputs - The system and the Linux argument reader ({@link ProfileProcessInputs}).
 * @returns The sorted processes.
 * @throws When the folder cannot be resolved.
 * @example
 * await ownedBrowserProcessSet(profile, { executable: '/opt/chrome/chrome', pid: 4242 }, listing, named) // => { main: { pid: 4242, … }, helpers: [{ pid: 4250, … }], foreign: [] }
 */
export async function ownedBrowserProcessSet(
  profile: string,
  marker: { executable: string; pid?: number },
  listing: ListedProcess[],
  named: ListedProcess[],
  inputs: ProfileProcessInputs = {},
): Promise<OwnedBrowserProcessSet> {
  // Without a recorded pid no process is the proven main: everything that names the folder is a stranger.
  const candidates =
    marker.pid === undefined
      ? []
      : named.filter(({ pid }) => pid === marker.pid)
  const [main] = await ownedBrowserProcesses(
    profile,
    marker.executable,
    candidates,
    inputs,
  )
  const parentOf = new Map(
    listing.map(({ pid, parentPid }) => [pid, parentPid]),
  )
  const others = named.filter((listed) => listed !== main)
  const helpers = others.filter(
    (listed) => main !== undefined && descendsFrom(listed, main.pid, parentOf),
  )
  return {
    main,
    helpers,
    foreign: others.filter((listed) => !helpers.includes(listed)),
  }
}
