import { readFile } from 'node:fs/promises'

import { z } from 'zod'

const recordedOwnerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().optional(),
  machineId: z.string().min(1).optional(),
  boot: z
    .union([
      z.object({ id: z.string().min(1) }),
      z.object({ startedAtMs: z.number() }),
    ])
    .optional(),
})

/** The process a storage lock, a takeover claim or a connection descriptor says wrote it, with the machine and the boot it ran under; a file of an earlier build records the process id alone, or with the host name. @example const owner: RecordedOwner = { pid: 4242, hostname: 'workstation', machineId: 'f3a1…', boot: { id: '0c1d…' } } */
export type RecordedOwner = z.infer<typeof recordedOwnerSchema>

/** Which start of its machine a process ran under: the kernel's boot id where the system publishes one, else the time the machine started ({@link readBootIdentity}). @example const boot: BootIdentity = { startedAtMs: 1_790_000_000_000 } */
export type BootIdentity = NonNullable<RecordedOwner['boot']>

/** The machine and the boot a process writes into what it owns and judges other owners by: a {@link RecordedOwner} without its process id, whose host name is always known ({@link currentStorageOwner}). @example const identity: StorageOwnerIdentity = { hostname: 'workstation', machineId: 'f3a1…', boot: { id: '0c1d…' } } */
export type StorageOwnerIdentity = Omit<RecordedOwner, 'pid' | 'hostname'> & {
  hostname: string
}

/**
 * Reads which process a private JSON file says wrote it, so {@link isStaleStorageLock} and {@link evidenceInUseElsewhere} can tell what a killed editor left behind from what a running one owns.
 * @param path - The lock, claim or descriptor file.
 * @returns
 * - The recorded process id, with the host name, the editor's machine id and the boot when the file names them
 * - `undefined` when the file cannot be read, is no JSON object, or records no process id (written by an earlier build)
 * @example
 * await readRecordedOwner('/storage/learning/writer.lock') // => { pid: 4242, hostname: 'workstation', boot: { id: '0c1d…' } }
 */
export async function readRecordedOwner(
  path: string,
): Promise<RecordedOwner | undefined> {
  const recorded: unknown = await readFile(path, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  const parsed = recordedOwnerSchema.safeParse(recorded)
  return parsed.success ? parsed.data : undefined
}
