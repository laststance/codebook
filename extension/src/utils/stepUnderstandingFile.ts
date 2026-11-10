import type { FileHandle } from 'node:fs/promises'

import { STEP_UNDERSTANDING_LIMIT_BYTES } from '../constants'
import {
  stepUnderstandingFileSchema,
  type StepUnderstandingDecision,
  type StepUnderstandingFile,
} from '../stepUnderstandingSchemas'

import { atomicPrivateBytes } from './atomicPrivateBytes'
import { openWithoutFollowing } from './openWithoutFollowing'
import {
  applyStepDecision,
  serializeStepUnderstanding,
  type CurrentStepHash,
} from './stepUnderstanding'
import { systemErrorCode } from './systemErrorCode'

/**
 * Reads a regular file through one open handle, never following a link and never holding more than the limit; called by {@link readStepUnderstandingFile}.
 * The size check and the read use the same handle, and the read stops one byte past the limit, so a file that grows or is replaced after the check cannot be read whole.
 * @param path - The file.
 * @param limitBytes - The largest allowed size.
 * @returns The file's bytes.
 * @throws The system's error when the path cannot be opened (`ENOENT` for a missing file, `ELOOP` for a link); an error when the file is no regular file or is over the limit.
 * @example await readRegularFileWithin(path, 262_144) // => <Buffer ...>
 */
async function readRegularFileWithin(
  path: string,
  limitBytes: number,
): Promise<Buffer> {
  const handle: FileHandle = await openWithoutFollowing(path)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limitBytes) throw notBoundedFile()
    // One byte past the limit shows growth after the size check.
    const buffer = Buffer.alloc(limitBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      )
      // End of file.
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > limitBytes) throw notBoundedFile()
    return buffer.subarray(0, length)
  } finally {
    await handle.close()
  }
}

/**
 * Builds the error of a step-understanding file that is no regular file or is over the limit; called by {@link readRegularFileWithin}.
 * @returns The error, not thrown yet.
 * @example throw notBoundedFile()
 */
function notBoundedFile(): Error {
  return new Error('The step-understanding file is not a bounded file.')
}

/**
 * Reads and checks a replay's step-understanding file; called by the stores of both replay families when a replay opens and under their lock before a write.
 * @param path - The file.
 * @param studyId - The replay the file must belong to.
 * @param limitBytes - The largest allowed size; defaults to {@link STEP_UNDERSTANDING_LIMIT_BYTES}.
 * @returns The parsed file, or `undefined` when none exists (`ENOENT`: no decision for any step).
 * @throws When the file is no regular file, is over the limit, does not match the schema or names another study; nothing is changed.
 * @example await readStepUnderstandingFile(path, studyId) // => { version: 1, studyId, decisions: [] }
 */
export async function readStepUnderstandingFile(
  path: string,
  studyId: string,
  limitBytes: number = STEP_UNDERSTANDING_LIMIT_BYTES,
): Promise<StepUnderstandingFile | undefined> {
  let bytes: Buffer
  try {
    bytes = await readRegularFileWithin(path, limitBytes)
  } catch (error) {
    if (systemErrorCode(error) === 'ENOENT') return undefined
    throw error
  }
  const file = stepUnderstandingFileSchema.parse(
    JSON.parse(bytes.toString('utf8')),
  )
  if (file.studyId !== studyId)
    throw new Error('The step-understanding file belongs to another replay.')
  return file
}

/**
 * Reads the file, applies one decision and writes it back atomically; the body of both stores' step saves, which run it under the replay family's storage lock.
 * @param path - The file.
 * @param studyId - The replay the decision is for.
 * @param change - The learner's decision.
 * @param currentSteps - The steps of the material current when the learner pressed, for the cap.
 * @param limitBytes - The largest allowed size; defaults to {@link STEP_UNDERSTANDING_LIMIT_BYTES}.
 * @returns The file as written.
 * @throws When the file cannot be read, the result is over the limit, or the write fails; the previous bytes stay.
 * @example await updateStepUnderstandingFile(path, studyId, decision, steps)
 */
export async function updateStepUnderstandingFile(
  path: string,
  studyId: string,
  change: StepUnderstandingDecision,
  currentSteps: readonly CurrentStepHash[],
  limitBytes: number = STEP_UNDERSTANDING_LIMIT_BYTES,
): Promise<StepUnderstandingFile> {
  const existing = await readStepUnderstandingFile(path, studyId, limitBytes)
  const next: StepUnderstandingFile = {
    version: 1,
    studyId,
    decisions: applyStepDecision(
      existing?.decisions ?? [],
      change,
      currentSteps,
    ),
  }
  await atomicPrivateBytes(path, serializeStepUnderstanding(next, limitBytes))
  return next
}
