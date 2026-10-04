import { readFile } from 'node:fs/promises'

import { z } from 'zod'

const recordedOwnerSchema = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().optional(),
})

/** The process a storage lock or a connection descriptor says wrote it. @example const owner: RecordedOwner = { pid: 4242, hostname: 'workstation' } */
export type RecordedOwner = z.infer<typeof recordedOwnerSchema>

/**
 * Reads which process a private JSON file says wrote it, so {@link isStaleStorageLock} and {@link evidenceInUseElsewhere} can tell what a killed editor left behind from what a running one owns.
 * @param path - The lock or descriptor file.
 * @returns
 * - The recorded process id, with the host name when the file names one
 * - `undefined` when the file cannot be read, is no JSON object, or records no process id (written by an earlier build)
 * @example
 * await readRecordedOwner('/storage/learning/writer.lock') // => { pid: 4242, hostname: 'workstation' }
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
