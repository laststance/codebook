import type { LearningSummary } from '../learningSummarySchemas'

/**
 * Masks the learner's secrets in a learning summary's text while every step keeps its reference as it was.
 *
 * Why it exists: a reference is an identity the saved study checks again (`snapshotUri`, `sourceHash`, `configurationHash`) and holds no learner text, while value masking would rewrite a hash or URI that happens to contain a short secret (a numeric PIN, a word like `cafe`) and make every save of that run fail. Called by {@link captureStudy} when it stores the summary.
 * @param summary - The summary as the chat saved it.
 * @param maskData - Masks every string of a value: the service's learner-secret mask.
 * @returns The summary with its text masked and its step references untouched.
 * @example
 * maskLearningSummaryText(summary, (value) => service.maskLearnerSecretsInData(value)).steps[0]?.reference // => the original reference
 */
export function maskLearningSummaryText(
  summary: LearningSummary,
  maskData: (value: LearningSummary) => LearningSummary,
): LearningSummary {
  const masked = maskData(summary)
  return {
    ...masked,
    // Each step's reference keeps its original bytes; only the text around it is masked.
    steps: masked.steps.map((step, index) => ({
      ...step,
      reference: summary.steps[index]?.reference,
    })),
  }
}
