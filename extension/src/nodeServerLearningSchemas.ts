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

/** The entries of a server history a learning step may cite: the request, a stop (with its source hash), an output (with its channel), the response or the request failure. */
export const nodeServerLearningReferenceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('request'), sequence }),
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
  z.strictObject({ type: z.literal('response'), sequence }),
  z.strictObject({ type: z.literal('request-failed'), sequence }),
])

/**
 * The learning material the chat saves for a server history: the same question, title, summary and evidence-classified sequence a test history has, citing the request, a stop, an output, the response or the request failure by journal sequence.
 * Read by {@link nodeServerStorageDescriptor}'s material codec; the save route that offers it to an agent is published by the producer part of Cycle 0059.
 * @example nodeServerLearningMaterialContentSchema.parse({ question, title, summary, participants, steps })
 */
export const nodeServerLearningMaterialContentSchema =
  buildNodeLearningMaterialContentSchema(
    nodeServerLearningReferenceSchema,
    'Required for an observed or source-derived step: the request, a stop, an output, the response or the request failure of this history by its sequence number (a stop with its sourceHash, an output with its channel); omit it only for an unknown step.',
    'Give it the reference of the request, a stop, an output, the response or the request failure of this history ({type, sequence}, with sourceHash for a stop and channel for an output), or label it unknown.',
  )

/** A saved server learning material: the content at a revision. */
export const nodeServerLearningMaterialSchema = z.strictObject({
  version: z.literal(NODE_TEST_LEARNING_MATERIAL_VERSION),
  studyId: studyIdSchema,
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  content: nodeServerLearningMaterialContentSchema,
})

export type NodeServerLearningMaterialContent = z.infer<
  typeof nodeServerLearningMaterialContentSchema
>
export type NodeServerLearningMaterial = z.infer<
  typeof nodeServerLearningMaterialSchema
>
