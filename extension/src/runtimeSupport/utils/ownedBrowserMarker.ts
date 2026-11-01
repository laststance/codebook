import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { OWNED_BROWSER_MARKER_FILE } from '../../constants'

/** What the {@link OWNED_BROWSER_MARKER_FILE} of a profile records about the browser Codebook spawned for it. */
export type OwnedBrowserMarker = {
  /** The executable the launch spawned, exactly as it was given to `spawn` (the browser's own `argv[0]`). */
  executable: string
  /** The spawned browser's process id; absent while the browser has not been spawned yet. It is the id of the browser's process group on POSIX. */
  pid?: number
  /**
   * The browser process's own start ({@link readProcessStart}) when the pid was recorded; a saved-session profile records it so that a reused pid of another Chrome is never signalled. Absent in a managed run's marker and in an older one.
   */
  processStart?: string
  /** How the browser was spawned: `detached` leads a process group of its own (so one signal reaches its helpers), `attached` does not (a js-debug launch). Absent means the group is not proven. */
  launchKind?: 'detached' | 'attached'
}

/**
 * Records the browser Codebook spawns for a profile folder, the proof by which the orphan sweep may stop that browser after an editor crash (ER18).
 * Called by the owned launch twice: before the spawn with the executable, and right after it with the process id.
 * @param folder - The profile folder.
 * @param marker - The executable and, once known, the pid.
 * @example
 * await writeOwnedBrowserMarker('/tmp/codebook-browser-a1b2c3', { executable: '/opt/chrome/chrome', pid: 4242 })
 */
export async function writeOwnedBrowserMarker(
  folder: string,
  marker: OwnedBrowserMarker,
): Promise<void> {
  await writeFile(
    join(folder, OWNED_BROWSER_MARKER_FILE),
    JSON.stringify(marker),
  )
}

/**
 * Reads the record of the browser Codebook spawned for a profile folder; called by the orphan sweep ({@link removeAbandonedProfiles}) before it may signal anything.
 * @param folder - The profile folder.
 * @returns The record; `undefined` when the file is absent, empty (an older launch wrote no content), not JSON or without an executable: then no process is proven to be Codebook's browser.
 * @example
 * await readOwnedBrowserMarker('/tmp/codebook-browser-a1b2c3') // => { executable: '/opt/chrome/chrome', pid: 4242 }
 */
export async function readOwnedBrowserMarker(
  folder: string,
): Promise<OwnedBrowserMarker | undefined> {
  const text = await readFile(
    join(folder, OWNED_BROWSER_MARKER_FILE),
    'utf8',
  ).catch(() => undefined)
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const executable = Reflect.get(parsed, 'executable')
  const pid = Reflect.get(parsed, 'pid')
  const processStart = Reflect.get(parsed, 'processStart')
  const launchKind = Reflect.get(parsed, 'launchKind')
  if (typeof executable !== 'string' || executable === '') return undefined
  return {
    executable,
    ...(typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && { pid }),
    ...(typeof processStart === 'string' &&
      processStart !== '' && { processStart }),
    ...((launchKind === 'detached' || launchKind === 'attached') && {
      launchKind,
    }),
  }
}
