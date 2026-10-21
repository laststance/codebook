import type { NodeTestLearningMaterialContent } from '../nodeTestHistorySchemas'

/** An explanation a test replay still lacks: the summary and sequence, a step for stop `stop` (one-based), or a step for the result. */
export type NodeLearningExplanationPart =
  { kind: 'summary' } | { kind: 'stop'; stop: number } | { kind: 'result' }

/** How much of a test replay the saved learning material explains, read by the agent as `nodeTest.learningCoverage`. */
export type NodeLearningCoverage = 'complete' | 'partial' | 'none'

/** What a sealed test history asks the learning material to explain: the journal sequence of each stop, in stop order, and of the result entry when there is one. */
export type NodeLearningNeeds = {
  stopSequences: readonly number[]
  resultSequence?: number
}

/**
 * Lists the explanations a test replay's learning material lacks, so the run resource's `nodeTest.learningMissing`, the history resource and Save name the same parts; called by {@link listMissingNodeLearning} for a read history and by {@link StudyService} for the coverage it caches at the seal and after each saved material.
 * A step explains a stop or the result when its reference names that entry's journal sequence; the store already checked each reference against the sealed journal ({@link NodeTestHistoryStore.saveLearningMaterial}).
 * @param needs - The stops and the result the history holds.
 * @param material - The saved material's content; `undefined` before the first save.
 * @returns The missing parts in the String catalog's order (summary, each stop, the result) and the coverage: `none` without material, `complete` with nothing missing, `partial` otherwise.
 * @example
 * listMissingNodeExplanations({ stopSequences: [2, 5], resultSequence: 7 }, undefined)
 * // => { missing: [{ kind: 'summary' }, { kind: 'stop', stop: 1 }, { kind: 'stop', stop: 2 }, { kind: 'result' }], coverage: 'none' }
 * listMissingNodeExplanations({ stopSequences: [2] }, materialCitingSequence2)
 * // => { missing: [], coverage: 'complete' }
 */
export function listMissingNodeExplanations(
  needs: NodeLearningNeeds,
  material: NodeTestLearningMaterialContent | undefined,
): { missing: NodeLearningExplanationPart[]; coverage: NodeLearningCoverage } {
  const cited = new Set(
    (material?.steps ?? []).flatMap((step) =>
      step.reference
        ? [`${step.reference.type}:${step.reference.sequence}`]
        : [],
    ),
  )
  const missing: NodeLearningExplanationPart[] = []
  // Without material nothing is explained: the summary and every step are missing.
  if (!material) missing.push({ kind: 'summary' })
  for (const [index, sequence] of needs.stopSequences.entries())
    if (!cited.has(`stop:${sequence}`))
      missing.push({ kind: 'stop', stop: index + 1 })
  if (
    needs.resultSequence !== undefined &&
    !cited.has(`result:${needs.resultSequence}`)
  )
    missing.push({ kind: 'result' })
  const coverage: NodeLearningCoverage = !material
    ? 'none'
    : missing.length
      ? 'partial'
      : 'complete'
  return { missing, coverage }
}
