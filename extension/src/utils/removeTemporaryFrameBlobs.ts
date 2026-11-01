import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { EXTENSION_HISTORY_FRAMES_DIRECTORY } from '../constants'

/**
 * Removes the temporary frame blobs (`frames/*.tmp`) a chrome-extension history's writer left behind.
 * Why: a frame blob is written under a temporary name and renamed once flushed; an editor that closed or crashed between the two leaves the temporary file, which no entry names.
 * Called by {@link ExtensionHistoryFrameWriter.removeTemporaryBlobs} when the history seals, and by the store through the extension descriptor when it reads a history that has no seal and no live writer. Never call it for a history another window still writes.
 * @param historyDirectory - The history's folder.
 * @returns Settles when the files are removed; never rejects (a folder that cannot be listed or a file that cannot be removed stays for the next call).
 * @example await removeTemporaryFrameBlobs(writer.historyDirectory)
 */
export async function removeTemporaryFrameBlobs(
  historyDirectory: string,
): Promise<void> {
  const directory = join(historyDirectory, EXTENSION_HISTORY_FRAMES_DIRECTORY)
  const names = await readdir(directory).catch(() => [])
  await Promise.all(
    names
      .filter((name) => name.endsWith('.tmp'))
      .map((name) =>
        rm(join(directory, name), { force: true }).catch(() => undefined),
      ),
  )
}
