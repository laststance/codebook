import type { LearningSummary } from '../learningSummarySchemas'

/**
 * Masks the learner's secrets in the free-text fields of a learning summary and nowhere else.
 *
 * Why it exists: a secret equal to an enum value (`observed`) or a participant id would, when masked inside `evidence`, `from`, `to` or an id, make the saved study fail its schema. Only the question, title, summary, participant labels, step labels and step explanations hold learner-visible prose. Called by {@link captureStudy} when it saves a summary.
 * @param summary - The learning summary of a run.
 * @param maskText - Masks the secrets in one text.
 * @returns A copy whose free-text fields are masked; ids, references, evidence and `from`/`to` keep their bytes.
 * @example
 * maskLearningSummaryText(summary, (text) => text.replaceAll('hunter2', '[masked]'))
 */
export function maskLearningSummaryText(
  summary: LearningSummary,
  maskText: (text: string) => string,
): LearningSummary {
  return {
    ...summary,
    question: maskText(summary.question),
    title: maskText(summary.title),
    summary: maskText(summary.summary),
    participants: summary.participants.map((participant) => ({
      ...participant,
      label: maskText(participant.label),
    })),
    steps: summary.steps.map((step) => ({
      ...step,
      label: maskText(step.label),
      explanation: maskText(step.explanation),
    })),
  }
}
