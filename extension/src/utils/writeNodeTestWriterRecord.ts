import { join } from 'node:path'

import {
  NODE_TEST_HISTORY_WRITER_FILE,
  NODE_TEST_HISTORY_WRITER_LIMIT_BYTES,
} from '../constants'

import { atomicPrivateWrite } from './atomicPrivateWrite'
import { currentStorageOwner } from './currentStorageOwner'

/**
 * Writes the full identity of this editor process (machine, boot and process start, as a storage lock records it) into the folder of a test history it starts, so that another window of the same workspace can tell a history that is being written from one whose writer crashed; called by {@link NodeTestHistoryStore.start} under the storage lock, after the history's first files.
 * The record is a help, not a part of the history: a record that cannot be written leaves the history to read as interrupted in other windows, as before.
 * @param historyDirectory - The history's folder.
 * @example await writeNodeTestWriterRecord('/storage/learning/node-tests.v1/<study id>')
 */
export async function writeNodeTestWriterRecord(
  historyDirectory: string,
): Promise<void> {
  try {
    await atomicPrivateWrite(
      join(historyDirectory, NODE_TEST_HISTORY_WRITER_FILE),
      { pid: process.pid, ...(await currentStorageOwner()) },
      NODE_TEST_HISTORY_WRITER_LIMIT_BYTES,
    )
  } catch {
    // Without the record other windows read the history as interrupted.
  }
}
