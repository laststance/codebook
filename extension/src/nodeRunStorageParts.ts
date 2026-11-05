import type { z } from 'zod'

import { NODE_TEST_LEARNING_MATERIAL_VERSION } from './constants'
import type {
  HistoryLearningMaterialCodec,
  HistorySealBase,
  HistoryTypes,
} from './historyStorageDescriptor'
import type {
  NodeServerSealReason,
  nodeRunOutputEntrySchema,
  nodeRunStopEntrySchema,
} from './nodeServerHistorySchemas'
import { assertNodeLearningCitations } from './utils/assertNodeLearningCitations'
import { capMissingList } from './utils/capMissingList'
import type { NodeServerLearningCoverage } from './utils/evaluateNodeServerLearning'
import type { CitableEvent } from './utils/recordingJournalScan'

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

/**
 * Reduces a stop or an output of a node run's journal to what a learning step may cite: a stop by its source hash, an output by its channel.
 * Called by each profile's descriptor for the entries they share.
 * @param entry - A stop or an output entry.
 * @returns The citable form.
 * @example citableRunEvidenceEvent(outputEntry) // => { type: 'output', channel: 'stdout' }
 */
export function citableRunEvidenceEvent(
  entry:
    | z.infer<typeof nodeRunStopEntrySchema>
    | z.infer<typeof nodeRunOutputEntrySchema>,
): CitableEvent {
  if (entry.type === 'output') return { type: 'output', channel: entry.channel }
  return {
    type: 'stop',
    sourceHash: entry.source.hash,
    path: entry.source.path,
    line: entry.source.line,
    declaredStopIndex: entry.declaredStopIndex,
  }
}

/**
 * Refuses a sealed node run journal whose seal contradicts what the entries establish: a torn last line, an entry count that differs, or a complete seal without the whole story.
 * @param subject - The profile's words for the history in the refusal (`Node server history`).
 * @param input - The seal, the entries read, whether the last line was incomplete and whether the journal tells the whole story (its end, and for a server its terminal entry).
 * @throws The refusal.
 * @example verifyRunSeal('Node script history', { seal, entries, hasIncompleteLine: false, storyIsWhole: progress.hasEnd })
 */
export function verifyRunSeal(
  subject: string,
  input: {
    seal: Pick<HistorySealBase, 'entryCount' | 'status'>
    entries: readonly unknown[]
    hasIncompleteLine: boolean
    storyIsWhole: boolean
  },
): void {
  const { seal } = input
  if (
    input.hasIncompleteLine ||
    seal.entryCount !== input.entries.length ||
    (seal.status === 'complete' && !input.storyIsWhole)
  )
    throw new Error(`Sealed ${subject} does not contain what its seal claims.`)
}

/**
 * Counts the fields every node run summary shares from a verified history: its status, stop counts, the capped capture reasons and learning gaps, the title and the material revision.
 * Called by each profile's `summarize` before it adds its own fields (a response, an end).
 * @param input - The history's status and reason, its entries, the capture reasons (the seal's, or judged now), the learning verdict and the saved material.
 * @returns The shared summary fields, verified.
 * @example summarizeRunEvidence({ status: 'complete', entries, reasons: [], learning: { coverage: 'complete', missing: [] } }).captureComplete // => true
 */
export function summarizeRunEvidence<LearningPart>(input: {
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  reason?: string
  entries: ReadonlyArray<{ type: string; declaredStopIndex?: number }>
  reasons: readonly NodeServerSealReason[]
  learning: { coverage: NodeServerLearningCoverage; missing: LearningPart[] }
  materialContent?: { title: string }
  materialRevision?: number
}) {
  const stops = input.entries.filter((entry) => entry.type === 'stop')
  const capture = capMissingList(input.reasons)
  const learningMissing = capMissingList(input.learning.missing)
  return {
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
    verification: 'verified' as const,
    stopCount: stops.length,
    reachedStopCount: new Set(stops.map((stop) => stop.declaredStopIndex)).size,
    captureComplete: input.reasons.length === 0,
    captureMissing: capture.items,
    captureMissingCount: capture.count,
    learningCoverage: input.learning.coverage,
    learningMissing: learningMissing.items,
    learningMissingCount: learningMissing.count,
    ...(input.materialContent ? { title: input.materialContent.title } : {}),
    materialRevision: input.materialRevision ?? 0,
  }
}
