import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import {
  DEVIN_MCP_RECORD_LIMIT_BYTES,
  PRIVATE_DIRECTORY_MODE,
} from '../constants'
import { DEVIN_SETUP_STORAGE_DIRECTORY } from '../devinWindowSentences'

import { atomicPrivateWrite } from './atomicPrivateWrite'
import { readPrivateJsonState } from './readPrivateJsonState'

/** The file, in the setup lock's folder of Codebook's global storage, that names the entry generation of a failed Devin Desktop setup whose take-back has not ended. */
const OWED_TAKE_BACK_FILE = 'take-back.json'

/** What the record holds: the generation the failed setup's entry write answered, which the take-back's removal takes back and nothing newer ({@link removeManagedDevinMcpEntry}'s `expectedGeneration`). */
const owedTakeBackSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.string().min(1),
})

/** Where the record lives under Codebook's global storage folder. */
const owedTakeBackPath = (storageRoot: string): string =>
  join(storageRoot, DEVIN_SETUP_STORAGE_DIRECTORY, OWED_TAKE_BACK_FILE)

/**
 * Records, before a failed Devin Desktop setup's take-back waits on anything else, that the entry it installed is still to be taken back, so a take-back that a reload or a closed window stopped is finished by the next run of any window ({@link readOwedDevinTakeBack}); called first by that take-back, for an entry its write answered `installed`.
 * @param storageRoot - Codebook's global storage folder.
 * @param generation - The generation the setup's entry write answered.
 * @throws What creating the folder or writing the record throws; the previous record then stays byte for byte.
 * @example
 * await recordOwedDevinTakeBack('/storage', 'f3b1c0de-…') // '/storage/devin-setup/take-back.json' now names that generation
 */
export async function recordOwedDevinTakeBack(
  storageRoot: string,
  generation: string,
): Promise<void> {
  await mkdir(join(storageRoot, DEVIN_SETUP_STORAGE_DIRECTORY), {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  })
  await atomicPrivateWrite(
    owedTakeBackPath(storageRoot),
    { schemaVersion: 1, generation },
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  )
}

/** What one look for an owed Devin Desktop take-back found: the generation its record names (`owed`), no record at all (`none`, the only proof that nothing is owed), or a record that cannot be used now (`unknown`: a read that got no answer, or a record that is not private, not a regular file or not of this shape), with the record's path for the line that names it. */
export type OwedDevinTakeBack =
  | { state: 'owed'; generation: string }
  | { state: 'none' }
  | { state: 'unknown'; recordPath: string }

/**
 * Looks for an owed Devin Desktop take-back ({@link recordOwedDevinTakeBack}); called under the setup lock by every Devin Desktop setup, removal and activation refresh, and once when a Devin Desktop window loads, so the next of them finishes a take-back that a reload stopped, and a setup or refresh that cannot tell refuses instead of keeping an entry the record may name.
 * @param storageRoot - Codebook's global storage folder.
 * @returns
 * - `owed` with the generation when a private record of this shape stands
 * - `none` only when there is no record
 * - `unknown` with the record's path when it cannot be used now (a read that got no answer, not private, not a regular file, not of this shape): a later look reads it again
 * @example
 * await readOwedDevinTakeBack('/storage') // => { state: 'owed', generation: 'f3b1c0de-…' } after a reload stopped a take-back
 * await readOwedDevinTakeBack('/storage') // => { state: 'none' } where no take-back is owed
 */
export async function readOwedDevinTakeBack(
  storageRoot: string,
): Promise<OwedDevinTakeBack> {
  const recordPath = owedTakeBackPath(storageRoot)
  const read = await readPrivateJsonState(recordPath)
  // Only a record that is not there proves that nothing is owed; a read that failed to look proves nothing.
  if (read.state === 'removed' && read.reason === 'missing')
    return { state: 'none' }
  const record =
    read.state === 'read' ? owedTakeBackSchema.safeParse(read.value) : undefined
  return record?.success
    ? { state: 'owed', generation: record.data.generation }
    : { state: 'unknown', recordPath }
}

/**
 * Deletes the record of an owed Devin Desktop take-back once its removal of the entry answered; called by that removal's step, in the take-back and when a later run finishes it.
 * @param storageRoot - Codebook's global storage folder.
 * @throws What deleting the file throws; a record that is already gone is no failure.
 * @example
 * await clearOwedDevinTakeBack('/storage')
 */
export async function clearOwedDevinTakeBack(
  storageRoot: string,
): Promise<void> {
  await rm(owedTakeBackPath(storageRoot), { force: true })
}
