import { realpath } from 'node:fs/promises'

import { listProcesses, type ListedProcess } from './listProcesses'

/**
 * Observes only the exact fresh Chrome profile during owned launch/cleanup; never signals other processes. Called by {@link HostBrowser} for its own profile, and by {@link removeAbandonedProfiles} for each candidate folder with the one listing of its sweep.
 * @param profile - The profile folder; it is resolved first, so a folder that is gone rejects.
 * @param processes - The processes to match, as {@link listProcesses} listed them; listed now when left out.
 * @returns The processes whose command line names the folder as `--user-data-dir`; a profile that only shares a prefix with it does not count.
 * @throws When the folder cannot be resolved, or the processes cannot be listed.
 * @example
 * await profileProcesses('/tmp/codebook-browser-unique') // => [{ pid: 4242, command: '… --user-data-dir=/private/tmp/codebook-browser-unique --headless=new' }]
 * await profileProcesses('/tmp/codebook-browser-unique', listing) // matched against a listing the caller made
 */
export async function profileProcesses(
  profile: string,
  processes?: ListedProcess[],
): Promise<ListedProcess[]> {
  const listed = processes ?? (await listProcesses())
  // Chrome/js-debug resolve /tmp symlinks before spawning on macOS.
  const argument = `--user-data-dir=${await realpath(profile)}`
  return listed.filter(({ command }) => {
    const offset = command.indexOf(argument)
    const following = command[offset + argument.length]
    // Prefix-sharing profiles do not establish ownership.
    return offset >= 0 && (!following || following === ' ')
  })
}
