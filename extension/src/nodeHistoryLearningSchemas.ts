import { z } from 'zod'

import { NODE_SERVER_HISTORY_MAX_ENTRIES } from './constants'
import { buildNodeLearningMaterialContentSchema } from './nodeTestHistorySchemas'
import { repositoryHashSchema } from './sourceSchemas'

const sequence = z
  .number()
  .int()
  .positive()
  .max(NODE_SERVER_HISTORY_MAX_ENTRIES)

/** Every entry a step of either history profile may cite: a node-test history has stops, outputs and the result; a node-server history the request, stops, outputs, the response or the request failure. One schema for both, so a malformed step is refused at its own element, whichever profile its study id names. */
const nodeHistoryReferenceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('request'), sequence }),
  z.strictObject({
    type: z.literal('stop'),
    sequence,
    sourceHash: repositoryHashSchema,
  }),
  z.strictObject({
    type: z.literal('output'),
    sequence,
    channel: z.enum(['stdout', 'stderr']),
  }),
  z.strictObject({ type: z.literal('result'), sequence }),
  z.strictObject({ type: z.literal('response'), sequence }),
  z.strictObject({ type: z.literal('request-failed'), sequence }),
])

/**
 * The content `codebook_explain_node_history` and the Study pane accept for either history profile, which the service parses again with the schema of the profile the study id resolves to, so a citation that does not fit that profile is refused as `INVALID_REFERENCE` naming it.
 * @example nodeHistoryLearningMaterialContentSchema.parse({ question, title, summary, participants, steps })
 */
export const nodeHistoryLearningMaterialContentSchema =
  buildNodeLearningMaterialContentSchema(
    nodeHistoryReferenceSchema,
    'Required for an observed or source-derived step: an entry of this history by its sequence number. node-test: a stop (with its sourceHash), an output (with its channel) or the result. node-server: the request, a stop (with its sourceHash), an output (with its channel), the response or the request failure. Omit it only for an unknown step.',
    'Give it the reference of an entry of this history ({type, sequence}, with sourceHash for a stop and channel for an output): node-test cites stops, outputs and the result, node-server the request, stops, outputs, the response or the request failure; or label it unknown.',
  )
