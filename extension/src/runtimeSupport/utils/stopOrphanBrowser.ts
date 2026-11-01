import type { ProcessStartReader } from '../../utils/readProcessStart'

import type { ListedProcess } from './listProcesses'
import type { OwnedBrowserMarker } from './ownedBrowserMarker'
import { ownedBrowserProcessSet } from './ownedBrowserProcesses'
import { profileProcesses } from './profileProcesses'
import { stopListedProcesses, type ProcessStopper } from './stopListedProcesses'
import { stopperGuardedByStart } from './stopperGuardedByStart'

/** The running stop's listing and signals: the abandoned-profile sweep's, or the saved-session store's. */
export type OrphanSweep = {
  stopper: ProcessStopper
  /** Lists the processes again, with their parents. */
  listAgain: () => Promise<ListedProcess[]>
}

/**
 * Stops the live browser of an owned profile whose editor is gone, so the folder can be removed (ER18) or opened again; called by {@link removeAbandonedProfiles} for an abandoned managed profile and by the saved-session store ({@link SavedSessionStore}) for the Chrome of a stale lock holder.
 * The processes are listed again right now, because the earlier listing may be minutes old and a pid can have been reused since. Only the browser's main process, proven by the pid and executable the launch recorded and the exact `--user-data-dir` ({@link ownedBrowserProcessSet}), is signalled, and never this process; its helpers end with it; when anything else still names the folder, nothing is signalled and the folder stays.
 * Without `proof` (a managed run's profile) the main process's group is signalled, as that launch is detached. With `proof` (a saved-session profile) the marker must record the browser's own start and that start must be what the system reports now, re-read before every signal ({@link stopperGuardedByStart}); a missing or different start, an unreadable one or an old-format marker signals nothing. The group is signalled only when the marker records a `detached` launch; otherwise only the main pid, since a debugger-launched Chrome leads no group of Codebook's.
 * @param profile - The owned profile folder.
 * @param marker - The executable, pid and, for a saved session, start and launch kind recorded in the folder's owned-browser marker.
 * @param sweep - The running stop, for its listing and signals.
 * @param proof - The reader of process starts that turns on the start proof; left out, no start is required.
 * @returns `true` when no process names the folder any more; `false` when something still does, including every case where the proof failed and nothing was signalled.
 * @example
 * await stopOrphanBrowser('/tmp/codebook-browser-a1b2c3', { executable: '/opt/chrome/chrome', pid: 4242 }, sweep) // => true
 * await stopOrphanBrowser(saved, { executable, pid: 4242, processStart: 'ps:…', launchKind: 'detached' }, sweep, { readStart }) // => true
 */
export async function stopOrphanBrowser(
  profile: string,
  marker: OwnedBrowserMarker,
  sweep: OrphanSweep,
  proof?: { readStart: ProcessStartReader },
): Promise<boolean> {
  const inputs = { pathsMayNotResolve: true }
  const listing = await sweep.listAgain()
  const named = await profileProcesses(profile, listing, inputs)
  // Nothing names the folder any more.
  if (named.length === 0) return true
  const { main, foreign } = await ownedBrowserProcessSet(
    profile,
    marker,
    listing,
    named,
    inputs,
  )
  // Without a proven main process, or with a stranger that only names the folder, nothing is signalled and the folder stays.
  if (main === undefined || foreign.length > 0) return false
  if (main.pid === process.pid) return false
  let stopper = sweep.stopper
  if (proof !== undefined) {
    // A saved session's marker must carry the browser's start, and it must match now; otherwise the pid may be another Chrome's.
    if (
      marker.processStart === undefined ||
      (await proof.readStart(main.pid)) !== marker.processStart
    )
      return false
    stopper = stopperGuardedByStart(
      sweep.stopper,
      { pid: main.pid, processStart: marker.processStart },
      proof.readStart,
    )
  }
  // The group is signalled when the launch is known to lead one: a managed profile's always, a saved session's only when recorded as detached.
  const leadsGroup = proof === undefined || marker.launchKind === 'detached'
  const stopped = await stopListedProcesses([main.pid], stopper, {
    groupLeaders: leadsGroup ? [main.pid] : [],
  })
  if (!stopped) return false
  // A fresh listing proves that nothing names the folder before it is removed.
  const remaining = await profileProcesses(
    profile,
    await sweep.listAgain(),
    inputs,
  )
  return remaining.length === 0
}
