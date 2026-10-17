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
 * Says whether the editor that reserved a recording directory may still be writing it, so that {@link LearningLibrary} takes the recording of a run whose study is not saved yet neither for what is left of a removed study nor for something a removal may move, and moves no study whose recording another window's run still writes.
 * A sealed recording is finished. An unsealed one counts as being written while the process its header names may run: one of another machine cannot be probed and counts as running, which is how {@link RecordingStore} judges a recording without a seal. A directory without a readable header was never handed to a writer.
 * @param directory - The directory of one recording.
 * @param ownProcess - `counts` (the default) when a recording this very process started counts like any other; `ignored` for {@link LearningLibrary.removeStudy}, which asks for other windows only: this window refuses to remove a study whose own run has not stopped, and a recording of its own that a stopped run left unsealed is no longer written.
 * @returns
 * - `false` for a sealed recording, for a directory whose header cannot be read, for an unsealed recording whose owner process has ended on this machine, and with `ignored` for one this process started
 * - `true` for an unsealed recording whose owner still runs on this machine or was started on another one
 * @example
 * await recordingMayStillBeWritten('/…/recordings.v2/<study id>') // => false once the run's recording is sealed
 * await recordingMayStillBeWritten('/…/recordings.v2/<study id>', 'ignored') // => false for the unsealed recording of this window's own stopped run
 */
export async function recordingMayStillBeWritten(
  directory: string,
  ownProcess: 'counts' | 'ignored' = 'counts',
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
  if (owner.hostname !== hostname()) return true
  // This process's own recording is left to the caller's own run state when it asks so.
  if (ownProcess === 'ignored' && owner.pid === process.pid) return false
  return !isProcessGone(owner.pid)
}
