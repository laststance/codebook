import { z } from 'zod'

import {
  NODE_SERVER_HISTORY_MAX_ENTRIES,
  NODE_SERVER_HISTORY_MAX_STOPS,
  NODE_TEST_LEARNING_MATERIAL_VERSION,
} from './constants'
import { studyIdSchema } from './legacyStudySchemas'
import { buildNodeLearningMaterialContentSchema } from './nodeTestHistorySchemas'
import { repositoryHashSchema } from './sourceSchemas'

const sequence = z
  .number()
  .int()
  .positive()
  .max(NODE_SERVER_HISTORY_MAX_ENTRIES)

/** The entries of a script history a learning step may cite: a stop (with its source hash), an output (with its channel) or the end. */
export const nodeScriptLearningReferenceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('stop'),
    sequence,
    sourceHash: repositoryHashSchema,
    // Optional and additive: when given, the cited stop must be a hit of this declared stop (0-based, as the events list shows it).
    declaredStopIndex: z
      .number()
      .int()
      .nonnegative()
      .max(NODE_SERVER_HISTORY_MAX_STOPS)
      .optional(),
  }),
  z.strictObject({
    type: z.literal('output'),
    sequence,
    channel: z.enum(['stdout', 'stderr']),
  }),
  z.strictObject({ type: z.literal('end'), sequence }),
])

/**
 * The learning material the chat saves for a script history: the same question, title, summary and evidence-classified sequence a server history has, citing a stop, an output or the end by journal sequence. A script has no request or response.
 * Read by {@link nodeScriptStorageDescriptor}'s material codec.
 * @example nodeScriptLearningMaterialContentSchema.parse({ question, title, summary, participants, steps })
 */
export const nodeScriptLearningMaterialContentSchema =
  buildNodeLearningMaterialContentSchema(
    nodeScriptLearningReferenceSchema,
    'Required for an observed or source-derived step: a stop, an output or the end of this history by its sequence number (a stop with its sourceHash, an output with its channel); omit it only for an unknown step.',
    'Give it the reference of a stop, an output or the end of this history ({type, sequence}, with sourceHash for a stop and channel for an output), or label it unknown.',
  )

/** A saved script learning material: the content at a revision. */
export const nodeScriptLearningMaterialSchema = z.strictObject({
  version: z.literal(NODE_TEST_LEARNING_MATERIAL_VERSION),
  studyId: studyIdSchema,
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  content: nodeScriptLearningMaterialContentSchema,
})

export type NodeScriptLearningMaterialContent = z.infer<
  typeof nodeScriptLearningMaterialContentSchema
>
export type NodeScriptLearningMaterial = z.infer<
  typeof nodeScriptLearningMaterialSchema
>
