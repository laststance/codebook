import { z } from 'zod'

import { NODE_SERVER_HISTORY_MAX_ENTRIES } from './constants'
import { nodeServerLearningReferenceSchema } from './nodeServerLearningSchemas'
import { buildNodeLearningMaterialContentSchema } from './nodeTestHistorySchemas'

/** Every entry a step of either history profile may cite: a node-server history has the request, stops, outputs, the response or the request failure (its own reference schema); a node-test history has stops, outputs and the result. One schema for both, so a malformed step is refused at its own element, whichever profile its study id names. */
const nodeHistoryReferenceSchema = z.discriminatedUnion('type', [
  ...nodeServerLearningReferenceSchema.options,
  z.strictObject({
    type: z.literal('result'),
    sequence: z.number().int().positive().max(NODE_SERVER_HISTORY_MAX_ENTRIES),
  }),
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
