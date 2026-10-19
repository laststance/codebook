import { z } from 'zod'

import { readWikiRegularFile } from './readWikiRegularFile'

/** The owner record of a lock, a claim, a descriptor, a marker or a recording's writer, as {@link readRecordedOwner} and {@link readRecordingWriterRecord} parse it. */
export const recordedOwnerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().optional(),
  machineId: z.string().min(1).optional(),
  /** The machine's two pseudonyms ({@link deriveMachineKeys}); a record written into a project folder names its machine by them alone. */
  machineKey: z.string().min(1).optional(),
  hostKey: z.string().min(1).optional(),
  /** The boot the owner ran under: its id (the kernel's boot id on Linux, the boot session on macOS), with the computed boot time beside it on macOS, or the computed boot time alone (Windows, 0.2.29.0 on macOS) ({@link readBootIdentity}). */
  boot: z
    .union([
      z.object({ id: z.string().min(1), startedAtMs: z.number().optional() }),
      z.object({ startedAtMs: z.number() }),
    ])
    .optional(),
  /** When the owner's process began ({@link readProcessStart}); absent in a record of 0.2.29.0 and in one of a window whose start could not be read. */
  processStart: z.string().min(1).optional(),
  /** The operating-system user the owner ran as ({@link currentUserName}); written into a managed browser profile's marker, whose sweep leaves the folder of another user. */
  user: z.string().min(1).optional(),
})

/** The process a storage lock, a takeover claim, a connection descriptor or a profile marker says wrote it, with the machine and the boot it ran under and the start of the process; a file of an earlier build records the process id alone, with the host name, or without the start. @example const owner: RecordedOwner = { pid: 4242, hostname: 'workstation', machineId: 'f3a1…', machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: '0c1d…' }, processStart: 'linux@4026531836:16362446' } */
export type RecordedOwner = z.infer<typeof recordedOwnerSchema>

/** Which start of its machine a process ran under: the boot's id where the system names one (the kernel's boot id on Linux, the boot session on macOS, with the boot time beside it), else the time the machine started ({@link readBootIdentity}). @example const boot: BootIdentity = { startedAtMs: 1_790_000_000_000 } */
export type BootIdentity = NonNullable<RecordedOwner['boot']>

/** The machine, the boot and the process start a process writes into what it owns and judges other owners by: a {@link RecordedOwner} without its process id, whose host name is always known ({@link currentStorageOwner}). @example const identity: StorageOwnerIdentity = { hostname: 'workstation', machineId: 'f3a1…', machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: '0c1d…' }, processStart: 'linux@4026531836:16362446' } */
export type StorageOwnerIdentity = Omit<RecordedOwner, 'pid' | 'hostname'> & {
  hostname: string
}

/**
 * Parses the bytes of an owner record; called by {@link readRecordedOwner} for the file it read.
 * @param bytes - The bytes of the lock, claim, descriptor or profile marker file.
 * @returns What the bytes say as JSON, or `undefined` for bytes that are no JSON.
 * @example
 * parseRecordedJson(Buffer.from('{"pid":4242}')) // => { pid: 4242 }
 * parseRecordedJson(Buffer.from(''))             // => undefined
 */
function parseRecordedJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Reads which process a JSON file says wrote it, so {@link isStaleStorageLock}, {@link evidenceInUseElsewhere}, {@link removeAbandonedProfiles} and the claim sweep of {@link claimWikiUpdateMarker} can tell what a killed editor left behind from what a running one owns.
 * The file is read as the Wiki's metadata files are ({@link readWikiRegularFile}): only a regular file of bounded size, without following a link and without waiting on a pipe. An owner record beside a Wiki update's marker lies in the learner's project folder, where a cloned repository can put a link to an endless device or to a pipe at its path.
 * @param path - The lock, claim, descriptor or profile marker file.
 * @returns
 * - The recorded process id, with the host name, the editor's machine id, the machine's pseudonyms, the boot and the process start when the file names them
 * - `undefined` when the path holds no regular file (a link, a pipe, a device, a folder), when the file cannot be read or is larger than a metadata file may be, is no JSON object, or records no process id (written by an earlier build)
 * @example
 * await readRecordedOwner('/storage/learning/writer.lock')                        // => { pid: 4242, hostname: 'workstation', boot: { id: '0c1d…' } }
 * await readRecordedOwner('/repo/.codebook/wiki.update-run.json.pending-a-link') // => undefined, at once
 */
export async function readRecordedOwner(
  path: string,
): Promise<RecordedOwner | undefined> {
  const recordFile = await readWikiRegularFile(path)
  if (!recordFile) return undefined
  const parsed = recordedOwnerSchema.safeParse(
    parseRecordedJson(recordFile.bytes),
  )
  return parsed.success ? parsed.data : undefined
}
