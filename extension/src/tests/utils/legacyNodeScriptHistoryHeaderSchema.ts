import { z } from 'zod'

import {
  MAX_EXPLANATION_CHARS,
  NODE_SCRIPT_LOADERS,
  NODE_SCRIPT_PROFILE,
  REPOSITORY_PATH_LIMIT_CHARS,
} from '../../constants'
import { studyIdSchema } from '../../legacyStudySchemas'
import {
  nodeRunDeclaredStopsSchema,
  nodeRunRepositoryRevisionSchema,
  nodeRunSourceHashesSchema,
} from '../../nodeServerHistorySchemas'
import { repositoryHashSchema } from '../../sourceSchemas'

/**
 * A frozen copy of the node-script history header schema of Codebook 0.2.92.0 (commit 976c3922), which reads only `formatVersion` 1. Tests parse headers with it to show what an older Codebook does with a format 2 history: it does not list it and does not delete it. Never update it to follow the product schema.
 * @example legacyNodeScriptHistoryHeaderSchema.parse(formatOneHeader) // => the header
 */
export const legacyNodeScriptHistoryHeaderSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    profile: z.literal(NODE_SCRIPT_PROFILE),
    workspaceKey: repositoryHashSchema,
    studyId: studyIdSchema,
    instanceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    packageRoot: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
    entry: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
    loader: z.enum(NODE_SCRIPT_LOADERS),
    declaredStops: nodeRunDeclaredStopsSchema,
    repositoryRevision: nodeRunRepositoryRevisionSchema,
    sourceHashes: nodeRunSourceHashesSchema,
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Node script history identity differs from its run.',
  )
