import { z } from 'zod'

/** The limits and names of Codebook 0.2.92.0, copied as literals so no product change moves them. */
const FROZEN = {
  profile: 'node-script',
  loaders: ['tsx', 'node'],
  explanationChars: 8_192,
  pathChars: 512,
  revisionChars: 1_024,
  stops: 16,
} as const

const frozenHash = z.string().regex(/^[a-f0-9]{64}$/)
const frozenPath = z.string().min(1).max(FROZEN.pathChars)

/**
 * A frozen copy of the node-script history header schema of Codebook 0.2.92.0 (commit 976c3922), which reads only `formatVersion` 1. Tests parse headers with it to show what an older Codebook does with a format 2 history: it does not list it and does not delete it. Every schema and limit it uses is copied here and it imports nothing from the product, so it never follows a change to it. Never update it to follow the product schema.
 * @example legacyNodeScriptHistoryHeaderSchema.parse(formatOneHeader) // => the header
 */
export const legacyNodeScriptHistoryHeaderSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    profile: z.literal(FROZEN.profile),
    workspaceKey: frozenHash,
    studyId: z.string().regex(/^[a-f0-9-]{36}_[a-f0-9-]{36}$/),
    instanceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    question: z.string().min(1).max(FROZEN.explanationChars),
    packageRoot: frozenPath,
    entry: frozenPath,
    loader: z.enum(FROZEN.loaders),
    declaredStops: z
      .array(
        z.strictObject({
          path: frozenPath,
          line: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(FROZEN.stops),
    repositoryRevision: z.strictObject({
      revision: z.string().min(1).max(FROZEN.revisionChars),
      dirty: z.boolean(),
    }),
    sourceHashes: z
      .array(z.strictObject({ path: frozenPath, hash: frozenHash }))
      .max(FROZEN.stops),
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Node script history identity differs from its run.',
  )
