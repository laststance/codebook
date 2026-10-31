import { z } from 'zod'

import {
  EXTENSION_HISTORY_MAX_ENTRIES,
  NODE_TEST_LEARNING_MATERIAL_VERSION,
} from './constants'
import { studyIdSchema } from './legacyStudySchemas'
import { buildNodeLearningMaterialContentSchema } from './nodeTestHistorySchemas'
import { repositoryHashSchema } from './sourceSchemas'

const sequence = z.number().int().positive().max(EXTENSION_HISTORY_MAX_ENTRIES)
/** The context a stop or pause citation names; required, because the stop registry allows a page stop and a service worker stop at one source location. */
const context = z.string().min(1).max(64)
const targetUrl = z.string().min(1).max(2_048).optional()
const workerGeneration = z.number().int().nonnegative().optional()

/** The entries of a chrome-extension history a learning step may cite: a captured stop (its capture, by source hash and context), a pause (its `pause-open`, by context) or the result. */
export const chromeExtensionLearningReferenceSchema = z.discriminatedUnion(
  'type',
  [
    z.strictObject({
      type: z.literal('stop'),
      sequence,
      sourceHash: repositoryHashSchema,
      context,
      targetUrl,
      workerGeneration,
    }),
    z.strictObject({
      type: z.literal('pause'),
      sequence,
      context,
      targetUrl,
      workerGeneration,
    }),
    z.strictObject({ type: z.literal('result'), sequence }),
  ],
)

/**
 * The learning material the chat saves for a chrome-extension history: the same question, title, summary and evidence-classified sequence a test or server history has, citing a capture (with its sourceHash and the context it was recorded in), a pause or the result by journal sequence.
 * Read by {@link createExtensionStorageDescriptor}'s material codec; saved by `codebook_explain_node_history`.
 * @example chromeExtensionLearningMaterialContentSchema.parse({ question, title, summary, participants, steps })
 */
export const chromeExtensionLearningMaterialContentSchema =
  buildNodeLearningMaterialContentSchema(
    chromeExtensionLearningReferenceSchema,
    'Required for an observed or source-derived step: a captured stop or the result of this history by its sequence number (a stop with its sourceHash and the context it was recorded in, page or service-worker; optionally its targetUrl or workerGeneration), or a pause with its context; omit it only for an unknown step.',
    'Give it the reference of a captured stop, a pause or the result of this history ({type, sequence}, with sourceHash and context for a stop and context for a pause), or label it unknown.',
  )

/** A saved chrome-extension learning material: the content at a revision. */
export const chromeExtensionLearningMaterialSchema = z.strictObject({
  version: z.literal(NODE_TEST_LEARNING_MATERIAL_VERSION),
  studyId: studyIdSchema,
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  content: chromeExtensionLearningMaterialContentSchema,
})

export type ChromeExtensionLearningMaterialContent = z.infer<
  typeof chromeExtensionLearningMaterialContentSchema
>
export type ChromeExtensionLearningMaterial = z.infer<
  typeof chromeExtensionLearningMaterialSchema
>
