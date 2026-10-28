import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'

import { PRIVATE_FILE_MODE } from '../constants'

/**
 * Publishes a complete private file only after its temporary bytes are flushed; called by {@link atomicPrivateWrite} for JSON values and by {@link LearningLibrary.removeStudy} to write a ledger's original bytes back.
 * @param path - The file to replace.
 * @param bytes - The complete new content.
 * @param beforePublish - Called synchronously after the bytes are flushed and just before the rename; throwing cancels the publication and leaves the existing file unchanged.
 * @param afterPublish - Called synchronously in the tick the rename resolved, before the temporary file's cleanup is awaited, so a caller learns of the publication without waiting on that cleanup.
 * @throws When the temporary file cannot be written or renamed, or `beforePublish` throws; the existing file is then unchanged.
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
  try {
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    beforePublish?.()
    await rename(temporary, path)
    afterPublish?.()
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
