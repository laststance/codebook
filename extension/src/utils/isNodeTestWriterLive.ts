import { join } from 'node:path'

import { NODE_TEST_HISTORY_WRITER_FILE } from '../constants'

import { currentStorageOwner } from './currentStorageOwner'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { readRecordedOwner } from './readRecordedOwner'

/**
 * Says whether the editor process named by a test history's writer record ({@link writeNodeTestWriterRecord}) may still be writing it; called by {@link NodeTestHistoryStore} for a history this window does not write and that has no seal, to list it as recording instead of interrupted and to read only its appended bytes.
 * The judgement is a storage lock owner's ({@link isRecordedOwnerGone}): a process of this machine that ended, an id that went to another process, and a record of an earlier boot call the writer gone. A writer this computer cannot probe (another machine) counts as live while its record stands.
 * @param historyDirectory - The history's folder.
 * @returns `true` when a record stands and its writer is not gone; `false` without a record, with one that cannot be read, and for a writer that is gone.
 * @example await isNodeTestWriterLive('/storage/learning/node-tests.v1/<study id>') // => false after the writing window crashed
 */
export async function isNodeTestWriterLive(
  historyDirectory: string,
): Promise<boolean> {
  const owner = await readRecordedOwner(
    join(historyDirectory, NODE_TEST_HISTORY_WRITER_FILE),
  )
  if (!owner) return false
  return !(await isRecordedOwnerGone(owner, await currentStorageOwner()))
}
