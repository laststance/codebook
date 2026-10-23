import type {
  NodeTestHistoryIndex,
  NodeTestLearningMaterial,
} from '../nodeTestHistorySchemas'

import { stripTerminalControls } from './stripTerminalControls'

/** Where a step of a test replay's learning material leads: the event its reference names, by sequence. */
export type NodeLearningStepPosition = {
  stepId: string
  sequence: number
}

/** A test replay's learning material as the Study pane's summary renderer takes it, the browser summary's shape, with each referenced step's event. */
export type NodeLearningSummaryProjection = {
  content: NodeTestLearningMaterial['content']
  positions: NodeLearningStepPosition[]
}

/**
 * Projects a test replay's saved learning material for the one summary renderer the browser replay also uses (Design 5), so each step can select the event it references; called by the Study workspace for each Study message while a test replay with material is selected.
 * A position names its event by sequence, so a step finds its own event even when several events share a time.
 * @param material - The saved learning material, absent when none was saved.
 * @param history - The selected history, all its entries.
 * @returns The material's content and, for each step whose reference names an event of the history, that event's sequence; `undefined` without material.
 * @example
 * projectNodeLearningSummary(material, history)?.positions // => [{ stepId: 'stop-1', sequence: 3 }]
 */
export function projectNodeLearningSummary(
  material: NodeTestLearningMaterial | undefined,
  history: Pick<NodeTestHistoryIndex, 'entries'>,
): NodeLearningSummaryProjection | undefined {
  if (!material) return
  const events = new Map(
    history.entries.map((entry) => [entry.sequence, entry] as const),
  )
  const positions: NodeLearningStepPosition[] = []
  for (const step of material.content.steps) {
    const event = step.reference && events.get(step.reference.sequence)
    // A step without a reference, or one whose event this history lacks, leads nowhere and gets no position.
    if (event)
      positions.push({
        stepId: step.id,
        sequence: event.sequence,
      })
  }
  return { content: shownLearningContent(material.content), positions }
}

/**
 * Removes terminal and bidirectional controls from every text of a test replay's learning material that the summary, its sequence and the Study section print, as {@link sanitizeNodeTestHistory} does for the recorded texts: the editor agent writes the material from output a test can shape, so a U+202E in it could otherwise reorder what the learner reads (F131, F341); called by {@link projectNodeLearningSummary}.
 * @param content - The material's content as saved.
 * @returns The content with its question, title, summary, participant labels, step labels and explanations free of controls; ids, evidence and references unchanged.
 * @example shownLearningContent(content).title // => 'Theme switch' for a saved 'Theme\u202E switch'
 */
function shownLearningContent(
  content: NodeTestLearningMaterial['content'],
): NodeTestLearningMaterial['content'] {
  return {
    ...content,
    question: stripTerminalControls(content.question),
    title: stripTerminalControls(content.title),
    summary: stripTerminalControls(content.summary),
    participants: content.participants.map((participant) => ({
      ...participant,
      label: stripTerminalControls(participant.label),
    })),
    steps: content.steps.map((step) => ({
      ...step,
      label: stripTerminalControls(step.label),
      explanation: stripTerminalControls(step.explanation),
    })),
  }
}
