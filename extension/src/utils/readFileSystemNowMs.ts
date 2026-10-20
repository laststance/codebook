import { open, unlink } from 'node:fs/promises'

import { PRIVATE_FILE_MODE } from '../constants'

/**
 * Reads the present by the clock of the file system that holds a file's folder: the modification time of an empty file created at that path now and removed at once; called by {@link removeLeftStagedConfigs} for its sweep of Cursor's settings folder, when it meets a staged config, and by {@link isLeftEmpty} for the storage lock's folder, when it meets an empty lock or claim.
 * Why: a network home or a file server stamps a file by its own clock, which this window's clock can run minutes ahead of or behind, and an age taken as this window's present less that stamp is wrong by the difference (a file staged this instant looks old, or a killed window's file looks young).
 * The caller names the probe, so that it stands where its sweep finds a leftover. In Cursor's folder it is named like a staged config ({@link newStagedConfigPath}), and one that a window killed in this instant left is swept by its age later. Beside a storage lock it is named like a prepared lock (`<lock>.pending-<uuid>`), never inside a claim folder, and one that a window killed in this instant left is swept by its age like any prepared lock ({@link removeStaleStorageClaims}). The time is read through the handle that created the file, before it is closed, so another window's sweep that removes the file cannot make the read fail.
 * @param probePath - Where the empty file is created; it must not exist.
 * @returns The file's modification time in epoch milliseconds, which is the file system's present within its stamp step (FAT rounds to 2 s); `undefined` when no file can be created there or its time cannot be read, so that the caller judges nothing by an unknown clock.
 * @example await readFileSystemNowMs(newStagedConfigPath('/home/user/.cursor')) // => 1_790_000_000_000 on the clock that stamps the files of that folder
 */
export async function readFileSystemNowMs(
  probePath: string,
): Promise<number | undefined> {
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
