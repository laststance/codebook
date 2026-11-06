import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'

import type { NodeHistoryRepository } from '../../nodeHistoryRepository'
import type { NodeScriptHistoryRecorder } from '../../nodeScriptHistoryRecorder'
import type {
  NodeScriptEnd,
  NodeScriptHistoryLibrary,
} from '../../nodeScriptHistorySchemas'
import type {
  NodeScriptLibraryObservedFacts,
  NodeScriptLibraryPreparedFacts,
} from '../../nodeScriptHistorySink'
import type { NodeScriptLearningMaterialContent } from '../../nodeScriptLearningSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { startNodeScriptHistory } from '../../utils/startNodeScriptHistory'

import {
  HANDLER_SOURCE_TEXT,
  openServerRepository,
} from './nodeServerHistoryFixture'
import { debuggerCapture } from './serverRunCapture'

/** The entry file every script history test declares. */
export const SCRIPT_ENTRY = 'scripts/seed.mjs'

/** One step reference of a script history's learning material, as its schema defines it. */
type ScriptStepReference =
  NodeScriptLearningMaterialContent['steps'][number]['reference'] & {}

/**
 * Builds a script learning material whose steps cite the given references, one observed step each.
 * @param references - The references to cite, in step order.
 * @returns The material's content.
 * @example await store.saveLearningMaterial(studyId, 0, scriptMaterialCiting([{ type: 'end', sequence: 4 }]))
 */
export function scriptMaterialCiting(
  references: ScriptStepReference[],
): NodeScriptLearningMaterialContent {
  return {
    question: 'What does the seed script do?',
    title: 'Seeding the store',
    summary: 'The script fills the store and exits.',
    participants: [{ id: 'script', label: 'Script' }],
    steps: references.map((reference, index) => ({
      id: `step-${index + 1}`,
      from: 'script',
      to: 'script',
      label: `${reference.type} ${index + 1}`,
      explanation: `The ${reference.type} happens.`,
      evidence: 'observed' as const,
      reference,
    })),
  }
}

/** What {@link runScriptHistory} drives through the sink, in order. */
export type ScriptRunScript = {
  /** How many stops the header declares. */
  declaredStops: number
  /** The declared stop index of each captured hit, in order. */
  hits: number[]
  /** Output chunks printed before the end. */
  output?: string[]
  /** How the run ended; `undefined` seals the history without the run's own end. */
  end?: NodeScriptEnd
  /** Told the capture budget was spent before the end. */
  budgetExhausted?: boolean
  /** A declared library: its identity makes the history format 2; the sink is told the preparation before the output and the observation before the end, when given. */
  library?: {
    identity: NodeScriptHistoryLibrary
    prepared?: NodeScriptLibraryPreparedFacts
    observed?: NodeScriptLibraryObservedFacts
  }
}

/**
 * Starts a script history through {@link startNodeScriptHistory}, feeds its sink the way a run would (output, stops, the end), seals it through the recorder and returns what a test reads.
 * @param context - The test whose end removes the learning directory.
 * @param script - What the run reports.
 * @param existing - A repository to write into, when the test already holds one.
 * @returns The repository, the study id and the recorder.
 * @example const { repository, studyId } = await runScriptHistory(context, { declaredStops: 1, hits: [0], end })
 */
export async function runScriptHistory(
  context: TestContext,
  script: ScriptRunScript,
  existing?: NodeHistoryRepository,
): Promise<{
  repository: NodeHistoryRepository
  studyId: string
  recorder: NodeScriptHistoryRecorder
}> {
  const repository =
    existing ?? (await openServerRepository(context)).repository
  const sourceHash = sha256(HANDLER_SOURCE_TEXT)
  const instanceId = randomUUID()
  const runId = randomUUID()
  const begun = await startNodeScriptHistory({
    repository,
    workspace: '/nonexistent-workspace',
    run: {
      instanceId,
      runId,
      createdAtMs: Date.parse('2026-11-05T00:00:00.000Z'),
      question: 'What does the seed script do?',
      packageRoot: '.',
      entry: SCRIPT_ENTRY,
      loader: 'node',
      declaredStops: Array.from(
        { length: script.declaredStops },
        (_, index) => ({
          path: 'src/handler.ts',
          line: 2 + index,
        }),
      ),
      sourceHashes: [{ path: 'src/handler.ts', hash: sourceHash }],
      ...(script.library ? { library: script.library.identity } : {}),
    },
    hideRoots: (text) => text,
    describeCause: String,
  })
  if (!('recorder' in begun)) throw new Error(begun.unavailable)
  const { recorder } = begun
  const hitCounts = new Map<number, number>()
  let elapsedMs = 10
  if (script.library?.prepared)
    recorder.sink.libraryPrepared(elapsedMs, script.library.prepared)
  for (const text of script.output ?? [])
    recorder.sink.output((elapsedMs += 10), 'stdout', text)
  for (const declaredStopIndex of script.hits) {
    hitCounts.set(
      declaredStopIndex,
      (hitCounts.get(declaredStopIndex) ?? 0) + 1,
    )
    recorder.sink.stop(
      (elapsedMs += 10),
      { declaredStopIndex },
      hitCounts.get(declaredStopIndex)!,
      debuggerCapture({ line: 2 + declaredStopIndex }),
    )
  }
  if (script.budgetExhausted) recorder.sink.markCaptureBudgetExhausted()
  if (script.library?.observed)
    recorder.sink.libraryObserved((elapsedMs += 10), script.library.observed)
  if (script.end) recorder.sink.end((elapsedMs += 10), script.end)
  await recorder.seal(undefined, 5_000)
  return { repository, studyId: `${instanceId}_${runId}`, recorder }
}
