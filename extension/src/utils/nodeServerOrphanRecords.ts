import { z } from 'zod'

import { NODE_SERVER_ORPHANS_STORAGE_KEY } from '../constants'

/** One launched server group, recorded so that a later activation can close it if the editor ended without doing so. */
const nodeServerOrphanRecordSchema = z.strictObject({
  runId: z.string().min(1),
  pid: z.number().int().positive(),
  processGroup: z.number().int().positive(),
  /** The leader's start as {@link readProcessStart} names it. */
  leaderStartedAt: z.string().min(1),
  /** The working folder's realpath at the launch. No identity input since 0.2.53.0 (a server may change its folder, and the start time decides); still written and required so a record parses in every version: the schema is strict and drops a malformed entry, which would lose the only trace of a running server. */
  cwd: z.string().min(1),
  inspectorPort: z.number().int().positive(),
  declaredPort: z.number().int().positive(),
})

/** A recorded server group. */
export type NodeServerOrphanRecord = z.infer<
  typeof nodeServerOrphanRecordSchema
>

/** The workspace storage the records live in: VS Code's `Memento` shape. */
export type NodeServerOrphanStore = {
  get(key: string): unknown
  update(key: string, value: unknown): Thenable<void> | Promise<void>
}

/**
 * Reads the recorded server groups from the store, dropping every entry that is malformed.
 * Called by {@link rememberNodeServerProcess}, {@link forgetNodeServerProcess} and {@link reapNodeServerOrphans}.
 * @param store - The workspace storage.
 * @returns The valid records, in stored order; empty when nothing or something malformed is stored.
 * @example readNodeServerOrphanRecords({ get: () => [{ runId: 'r', pid: 5 }], update }) // => []
 */
export function readNodeServerOrphanRecords(
  store: NodeServerOrphanStore,
): NodeServerOrphanRecord[] {
  const stored = store.get(NODE_SERVER_ORPHANS_STORAGE_KEY)
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry: unknown) => {
    const parsed = nodeServerOrphanRecordSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}
