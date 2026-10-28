import type { NodeServerLearningMaterialContent } from '../../nodeServerLearningSchemas'

/** One step reference of a server history's learning material, as its schema defines it. */
export type ServerStepReference =
  NodeServerLearningMaterialContent['steps'][number]['reference'] & {}

/**
 * Builds a server learning material whose steps cite the given references, one observed step each, for the tests that save material to a history.
 * @param references - The references to cite, in step order; each step is named by its type and position.
 * @returns The material's content.
 * @example await store.saveLearningMaterial(studyId, 0, serverMaterialCiting([{ type: 'request', sequence: 1 }]))
 */
export function serverMaterialCiting(
  references: ServerStepReference[],
): NodeServerLearningMaterialContent {
  return {
    question: 'How does the server create an item?',
    title: 'Creating an item',
    summary: 'The handler creates the item and answers.',
    participants: [{ id: 'server', label: 'Handler' }],
    steps: references.map((reference, index) => ({
      id: `step-${index + 1}`,
      from: 'server',
      to: 'server',
      label: `${reference.type} ${index + 1}`,
      explanation: `The ${reference.type} happens.`,
      evidence: 'observed' as const,
      reference,
    })),
  }
}
