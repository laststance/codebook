import { lstat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_HEADER_FILE,
  RECORDING_SEAL_FILE,
} from '../constants'
import { recordingHeaderSchema } from '../recordingSchemas'

import { isProcessGone } from './isProcessGone'
import { readBoundedFile } from './readBoundedFile'

/** The owner a recording's header names, read without the rest of the header, whose other fields depend on the recording's format. */
const headerOwnerSchema = z.object({ owner: recordingHeaderSchema.shape.owner })

/**
 * Says whether the editor that reserved a recording directory may still be writing it, so that {@link LearningLibrary} takes the recording of a run whose study is not saved yet neither for what is left of a removed study nor for something a removal may move.
 * A sealed recording is finished. An unsealed one counts as being written while the process its header names may run: one of another machine cannot be probed and counts as running, which is how {@link RecordingStore} judges a recording without a seal. A directory without a readable header was never handed to a writer.
 * @param directory - The directory of one recording.
 * @returns
 * - `false` for a sealed recording, for a directory whose header cannot be read, and for an unsealed recording whose owner process has ended on this machine
 * - `true` for an unsealed recording whose owner still runs on this machine or was started on another one
 * @example
 * await recordingMayStillBeWritten('/…/recordings.v2/<study id>') // => false once the run's recording is sealed
 */
export async function recordingMayStillBeWritten(
  directory: string,
): Promise<boolean> {
  const isSealed = await lstat(join(directory, RECORDING_SEAL_FILE)).then(
    () => true,
    () => false,
  )
  if (isSealed) return false
  const owner = await readBoundedFile(
    join(directory, RECORDING_HEADER_FILE),
    MAX_RECORDING_HEADER_BYTES,
  )
    .then(
      (bytes) => headerOwnerSchema.parse(JSON.parse(bytes.toString())).owner,
    )
    .catch(() => undefined)
  if (!owner) return false
  // Only a process of this machine can be probed; any other owner may still be writing.
  return owner.hostname !== hostname() || !isProcessGone(owner.pid)
}
