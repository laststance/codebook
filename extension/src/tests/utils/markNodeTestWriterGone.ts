import { writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import {
  NODE_TEST_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_WRITER_FILE,
} from '../../constants'

import { ID_OF_NO_PROCESS } from './idOfNoProcess'

/**
 * Makes a test history read as one whose writing editor window crashed: its writer record names a process of this machine that no system has. A test that reopens an unsealed history in a new store to stand for an editor restart calls it, because the writer in the test is a live process of this very run (F260).
 * @param learningDirectory - The learning directory of the store.
 * @param studyId - The history's study id.
 * @example await markNodeTestWriterGone(directory, header.studyId)
 */
export async function markNodeTestWriterGone(
  learningDirectory: string,
  studyId: string,
): Promise<void> {
  await writeFile(
    join(
      learningDirectory,
      NODE_TEST_HISTORY_DIRECTORY,
      studyId,
      NODE_TEST_HISTORY_WRITER_FILE,
    ),
    JSON.stringify({ pid: ID_OF_NO_PROCESS, hostname: hostname() }),
  )
}
