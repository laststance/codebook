import { realpath } from 'node:fs/promises'

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

/**
 * Observes only the exact fresh Chrome profile during owned launch/cleanup; never signals other processes. Called by {@link HostBrowser} for its own profile, and by {@link removeAbandonedProfiles} for each candidate folder with the one listing of its sweep.
 * On Windows the command line is split into its arguments by the rules of the Microsoft C runtime ({@link windowsCommandLineArguments}) and the profile argument is compared whole: a profile path that holds a space is written in quotes there, around the whole argument or around its value, so it ends at a quote. On macOS and Linux the argument is found in the text `ps` printed.
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
  const argument = `--user-data-dir=${await realpath(profile)}`
  // Windows keeps a command line as one text with quoted arguments; it is read argument by argument.
  if ((inputs.platform ?? process.platform) === 'win32')
    return listed.filter(({ command }) =>
      windowsCommandLineArguments(command).includes(argument),
    )
  return listed.filter(({ command }) => namesArgumentByText(command, argument))
}
