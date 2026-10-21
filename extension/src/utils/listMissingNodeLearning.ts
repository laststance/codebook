import type {
  NodeTestHistoryIndex,
  NodeTestLearningMaterialContent,
} from '../nodeTestHistorySchemas'

import {
  listMissingNodeExplanations,
  type NodeLearningCoverage,
  type NodeLearningExplanationPart,
  type NodeLearningNeeds,
} from './listMissingNodeExplanations'
import { nodeStopSourceMatches } from './nodeStopSourceMatches'

/** Recorded evidence a test replay lacks, which no explanation can add: the debugger state of stop `stop` (one-based), or the complete execution up to its result. */
export type NodeLearningCapturePart =
  { kind: 'stop-state'; stop: number } | { kind: 'execution' }

/** Any part a test replay's Save can name as missing, an explanation or a capture. */
export type NodeLearningPart =
  NodeLearningExplanationPart | NodeLearningCapturePart

/**
 * Reads what a test history's journal asks its learning material to explain; the needs {@link listMissingNodeExplanations} checks.
 * @param history - The verified history.
 * @returns The journal sequence of each stop in stop order, and of the result entry when there is one.
 * @example
 * needsOfHistory(history) // => { stopSequences: [2, 5], resultSequence: 7 }
 */
function needsOfHistory(
  history: Pick<NodeTestHistoryIndex, 'entries'>,
): NodeLearningNeeds {
  const result = history.entries.find((entry) => entry.type === 'result')
  return {
    stopSequences: history.entries
      .filter((entry) => entry.type === 'stop')
      .map((entry) => entry.sequence),
    ...(result ? { resultSequence: result.sequence } : {}),
  }
}

/**
 * Lists what a read test replay lacks, as structured parts every surface words through {@link describeNodeLearningPart}: the explanations its material lacks and the recorded evidence its journal lacks; called by {@link NodeLearningSave} after the seal and by {@link NodeTestHistoryStore.list} for the summary Saved studies and the history resource read. It imports neither the service nor the workspace, so both can call it.
 * Capture gaps never ask the chat for an explanation: a stop whose debugger state is empty or whose captured source does not verify ({@link nodeStopSourceMatches}), and a history that ended (sealed partial or interrupted) before its result.
 * @param history - The verified history: its status and entries.
 * @param material - The saved material's content; `undefined` before the first save.
 * @returns `explanations` and `capture` in the String catalog's order, and the explanation coverage (`none`, `partial` or `complete`).
 * @example
 * listMissingNodeLearning(sealedPassingHistory, undefined)
 * // => { explanations: [{ kind: 'summary' }, { kind: 'stop', stop: 1 }, { kind: 'result' }], capture: [], coverage: 'none' }
 * listMissingNodeLearning(historyCutBeforeItsResult, explainingMaterial)
 * // => { explanations: [], capture: [{ kind: 'execution' }], coverage: 'complete' }
 */
export function listMissingNodeLearning(
  history: Pick<NodeTestHistoryIndex, 'entries' | 'status'>,
  material: NodeTestLearningMaterialContent | undefined,
): {
  explanations: NodeLearningExplanationPart[]
  capture: NodeLearningCapturePart[]
  coverage: NodeLearningCoverage
} {
  const needs = needsOfHistory(history)
  const { missing, coverage } = listMissingNodeExplanations(needs, material)
  const capture: NodeLearningCapturePart[] = []
  const stops = history.entries.filter((entry) => entry.type === 'stop')
  // A stop without frames, or whose captured source does not verify, cannot be shown in the replay debugger.
  for (const [index, stop] of stops.entries())
    if (!stop.debuggerSnapshot.frames.length || !nodeStopSourceMatches(stop))
      capture.push({ kind: 'stop-state', stop: index + 1 })
  // A history that ended before its result lacks the rest of the execution; a sealed failing run has its result.
  if (
    (history.status === 'partial' || history.status === 'interrupted') &&
    needs.resultSequence === undefined
  )
    capture.push({ kind: 'execution' })
  return { explanations: missing, capture, coverage }
}
