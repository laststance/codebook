import { join } from 'node:path'

import { NODE_TEST_HISTORY_WRITER_FILE } from '../constants'

import { currentStorageOwner } from './currentStorageOwner'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { readRecordedOwner } from './readRecordedOwner'

/** What a test history's writer record says of its writer: `live` while the process it names may still write, `gone` once that process is known to have ended, `unread` when the record could not be read this time. */
export type NodeTestWriterVerdict = 'live' | 'gone' | 'unread'

/**
 * Judges whether the editor process named by a test history's writer record ({@link writeNodeTestWriterRecord}) may still be writing it; called by {@link NodeTestHistoryStore} for a history this window does not write and that has no seal, to list it as recording instead of interrupted and to read only its appended bytes.
 * The judgement is a storage lock owner's ({@link isRecordedOwnerGone}): a process of this machine that ended, an id that went to another process, and a record of an earlier boot call the writer gone. A writer this computer cannot probe (another machine) counts as live while its record stands. A record that cannot be read is `unread`, not `gone`: a transient I/O error (EMFILE, EBUSY) says nothing of the writer, so the store judges it again (F347).
 * @param historyDirectory - The history's folder.
 * @returns
 * - `live` when a record stands and its writer is not gone
 * - `gone` when its writer is known to have ended
 * - `unread` when the record is missing, unreadable or malformed this time
 * @example await judgeNodeTestWriter('/storage/learning/node-tests.v1/<study id>') // => 'gone' after the writing window crashed
 */
export async function judgeNodeTestWriter(
  historyDirectory: string,
): Promise<NodeTestWriterVerdict> {
  const owner = await readRecordedOwner(
    join(historyDirectory, NODE_TEST_HISTORY_WRITER_FILE),
  )
  if (!owner) return 'unread'
  return (await isRecordedOwnerGone(owner, await currentStorageOwner()))
    ? 'gone'
    : 'live'
}
