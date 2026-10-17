import { readFile, writeFile } from 'node:fs/promises'

import { recordingOwnerRecordPath } from '../../utils/recordingOwnerRecordPath'

/**
 * Rewrites fields of the record of a recording's writer that this build keeps beside the recordings ({@link recordingOwnerRecordPath}), for a test that names another editor process, host name, machine or process start there, as it does in the header; every other field stays as the recording store wrote it, and a field given as `undefined` is left out.
 * @param learningDirectory - The learning directory of the test's recording store.
 * @param studyId - The recording's study id.
 * @param change - The fields to put in the record.
 * @example
 * await rewriteWriterRecord(directory, studyId, { pid: 2 ** 22 + 1 }) // the record names a process id of no process
 * await rewriteWriterRecord(directory, studyId, { machineId: 'machine-b' }) // the record names another machine
 */
export async function rewriteWriterRecord(
  learningDirectory: string,
  studyId: string,
  change: Record<string, unknown>,
): Promise<void> {
  const path = recordingOwnerRecordPath(learningDirectory, studyId)
  const record: Record<string, unknown> = JSON.parse(
    await readFile(path, 'utf8'),
  )
  await writeFile(path, JSON.stringify({ ...record, ...change }))
}
