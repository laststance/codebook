import { randomUUID } from 'node:crypto'
import { open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { PRIVATE_FILE_MODE } from '../constants'

/** The end of a staged Cursor config's name, which the probe in Cursor's folder takes as its own. */
const CURSOR_STAGED_CONFIG_SUFFIX = '.mcp.json'

/**
 * Reads the present by the clock of the file system that holds a folder: the modification time of an empty file created there now and removed at once; called by {@link removeLeftStagedConfigs} for its sweep of Cursor's settings folder, when it meets a staged config, and by {@link isLeftEmpty} for the storage folder, when it meets an empty lock or claim.
 * Why: a network home or a file server stamps a file by its own clock, which this window's clock can run minutes ahead of or behind, and an age taken as this window's present less that stamp is wrong by the difference (a file staged this instant looks old, or a killed window's file looks young).
 * The file is empty and named `.codebook-<uuid><nameSuffix>`. In Cursor's folder the default suffix makes it look like a staged config (`.codebook-<uuid>.mcp.json`), so one that a window killed in this instant left is swept by its age later. In the storage folder a caller passes a suffix that no step of Codebook matches (no sweep of the lock, no store's listing), so the probe is never read as a lock, a claim, a study or a book; one that a window killed in this instant left stays there as a hidden empty file that nothing reads, at most one for each such kill. The time is read through the handle that created the file, before it is closed, so another window's sweep that removes the file cannot make the read fail.
 * @param directory - The folder whose file system's clock is asked, where a file can be created.
 * @param nameSuffix - What the probe's name ends with after `.codebook-<uuid>`; {@link CURSOR_STAGED_CONFIG_SUFFIX} (the name of a staged Cursor config) unless the folder is not Cursor's.
 * @returns The file's modification time in epoch milliseconds, which is the file system's present within its stamp step (FAT rounds to 2 s); `undefined` when no file can be created there or its time cannot be read, so that the caller judges nothing by an unknown clock.
 * @example await readFileSystemNowMs('/home/user/.cursor') // => 1_790_000_000_000 on the clock that stamps the files of that folder
 */
export async function readFileSystemNowMs(
  directory: string,
  nameSuffix: string = CURSOR_STAGED_CONFIG_SUFFIX,
): Promise<number | undefined> {
  const probePath = join(directory, `.codebook-${randomUUID()}${nameSuffix}`)
  let probe
  try {
    probe = await open(probePath, 'wx', PRIVATE_FILE_MODE)
  } catch {
    // A folder that takes no new file leaves the clock unknown.
    return undefined
  }
  try {
    return (await probe.stat()).mtimeMs
  } catch {
    return undefined
  } finally {
    await probe.close().catch(() => undefined)
    await unlink(probePath).catch(() => undefined)
  }
}
