import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'

import { PRIVATE_FILE_MODE } from '../constants'

/**
 * Publishes a complete private file only after its temporary bytes are flushed; called by {@link atomicPrivateWrite} for JSON values and by {@link LearningLibrary.removeStudy} to write a ledger's original bytes back.
 * @param path - The file to replace.
 * @param bytes - The complete new content.
 * @param beforePublish - Called synchronously after the bytes are flushed and just before the rename; throwing cancels the publication and leaves the existing file unchanged.
 * @param afterPublish - Called synchronously in the tick the rename resolved, before the temporary file's cleanup is awaited, so a caller learns of the publication without waiting on that cleanup.
 * @throws When the temporary file cannot be written or renamed, or `beforePublish` throws; the existing file is then unchanged. A failure of the temporary file's cleanup after a successful rename is ignored: the file is published, and no copy can remain, because the rename moved the temporary name's bytes to `path`, so the name the failed cleanup concerns no longer exists.
 * @example
 * await atomicPrivateBytes(ledgerPath, bytesBeforeTheRemoval)
 */
export async function atomicPrivateBytes(
  path: string,
  bytes: string | Buffer,
  beforePublish?: () => void,
  afterPublish?: () => void,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
  let didPublish = false
  try {
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    beforePublish?.()
    await rename(temporary, path)
    didPublish = true
    afterPublish?.()
  } finally {
    await unlink(temporary).catch((error) => {
      // After the rename the replacement is complete and the temporary name is gone: a cleanup fault must not turn a published file into a rejected publish.
      if (error.code !== 'ENOENT' && !didPublish) throw error
    })
  }
}
