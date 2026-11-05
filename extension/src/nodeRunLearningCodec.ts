import type { z } from 'zod'

import { NODE_TEST_LEARNING_MATERIAL_VERSION } from './constants'
import type {
  HistoryLearningMaterialCodec,
  HistoryTypes,
} from './historyStorageDescriptor'
import { assertNodeLearningCitations } from './utils/assertNodeLearningCitations'

/**
 * Builds the learning-material codec of a node run profile (server or script): how a saved material file and an agent's content parse, how a material is built at its revision, and how a step's citation is checked against the journal.
 * Why: both profiles keep the same material shape and the same citation check; only their schemas differ.
 * @param materialSchema - The profile's saved-material schema.
 * @param contentSchema - The profile's content schema.
 * @returns The codec a storage descriptor carries.
 * @example const codec = buildNodeRunLearningCodec<NodeScriptHistoryTypes>(nodeScriptLearningMaterialSchema, nodeScriptLearningMaterialContentSchema)
 */
export function buildNodeRunLearningCodec<Types extends HistoryTypes>(
  materialSchema: z.ZodType<Types['Material']>,
  contentSchema: z.ZodType<Types['MaterialContent']>,
): HistoryLearningMaterialCodec<Types> {
  return {
    parseMaterial: (value) => materialSchema.parse(value),
    parseContent: (value) => contentSchema.parse(value),
    buildMaterial: (input) =>
      materialSchema.parse({
        version: NODE_TEST_LEARNING_MATERIAL_VERSION,
        ...input,
      }),
    assertCitations: (content, citable, lead): void =>
      assertNodeLearningCitations(content, citable, {
        lead,
        withNearest: true,
      }),
  }
}

/**
 * Collects the journal sequences a saved learning material cites, so a summary can tell which recorded entries its steps explain.
 * @param content - The material's content.
 * @returns The cited sequences.
 * @example citedSequencesOf({ steps: [{ id: 's1', reference: { type: 'end', sequence: 4 } }] }) // => Set { 4 }
 */
export function citedSequencesOf(
  content: HistoryTypes['MaterialContent'],
): Set<number> {
  return new Set(
    content.steps.flatMap((step) =>
      step.reference ? [step.reference.sequence] : [],
    ),
  )
}
