import type { NodeLearningPart } from './listMissingNodeLearning'

/**
 * Words one missing part of a test replay the same way on every surface (the status item's tooltip, the partial-save notification, Saved studies and the agent's help), so structured parts reach the learner as the String catalog writes them; called by {@link describeNodeLearningSave} and {@link NodeLearningSave}.
 * @param part - A part {@link listMissingNodeLearning} returned.
 * @returns The part's words.
 * @example
 * describeNodeLearningPart({ kind: 'summary' })              // => 'learning summary and sequence'
 * describeNodeLearningPart({ kind: 'stop', stop: 2 })        // => 'an explanation step for stop 2'
 * describeNodeLearningPart({ kind: 'result' })               // => 'an explanation step for the result'
 * describeNodeLearningPart({ kind: 'stop-state', stop: 1 })  // => 'recorded debugger state of stop 1'
 * describeNodeLearningPart({ kind: 'execution' })            // => 'complete execution evidence'
 */
export function describeNodeLearningPart(part: NodeLearningPart): string {
  switch (part.kind) {
    case 'summary':
      return 'learning summary and sequence'
    case 'stop':
      return `an explanation step for stop ${part.stop}`
    case 'result':
      return 'an explanation step for the result'
    case 'stop-state':
      return `recorded debugger state of stop ${part.stop}`
    case 'execution':
      return 'complete execution evidence'
  }
}
