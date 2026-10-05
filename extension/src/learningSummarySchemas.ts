import { z } from 'zod'

import {
  MAX_EXPLANATION_CHARS,
  REFERENCE_LENGTH_LIMIT,
  LEARNING_SUMMARY_LIMITS,
} from './constants'
import { learningSummaryIssues } from './utils/learningSummaryIssues'

export const learningStepIdSchema = z
  .string()
  .min(1)
  .max(LEARNING_SUMMARY_LIMITS.identifierChars)
  .regex(/^[a-zA-Z0-9_-]+$/)
const sourceReference = z.strictObject({
  snapshotUri: z.string().min(1).max(REFERENCE_LENGTH_LIMIT),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
})
const terminalReference = z.strictObject({
  kind: z.literal('terminal'),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  captureHash: z.string().regex(/^[a-f0-9]{64}$/),
})
const reference = z.union([sourceReference, terminalReference])
export const learningSummarySchema = z
  .strictObject({
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    title: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.titleChars),
    summary: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    participants: z
      .array(
        z.strictObject({
          id: learningStepIdSchema,
          label: z
            .string()
            .min(1)
            .max(LEARNING_SUMMARY_LIMITS.participantLabelChars),
        }),
      )
      .min(1)
      .max(LEARNING_SUMMARY_LIMITS.participants),
    steps: z
      .array(
        z.strictObject({
          id: learningStepIdSchema,
          from: learningStepIdSchema,
          to: learningStepIdSchema,
          label: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.stepLabelChars),
          explanation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
          evidence: z.enum(['observed', 'source-derived', 'unknown']),
          reference: reference
            .optional()
            .describe(
              "Required for an observed or source-derived step: the snapshotUri and sourceHash of a committed observation of this run, or after the result the run's terminalReference; omit it only for an unknown step.",
            ),
        }),
      )
      .min(1)
      .max(LEARNING_SUMMARY_LIMITS.steps),
  })
  .superRefine((value, context) => {
    // Each broken rule is its own issue at the offending element, so an agent corrects that element instead of dropping the summary.
    for (const issue of learningSummaryIssues(
      value,
      'learningSummary',
      'Give it the reference {snapshotUri, sourceHash} of a committed observation of this run, or label it unknown.',
    ))
      context.addIssue({ code: 'custom', ...issue })
  })
  .refine(
    (value) =>
      Buffer.byteLength(JSON.stringify(value), 'utf8') <=
      LEARNING_SUMMARY_LIMITS.bytes,
    'Learning summary exceeds its total byte limit.',
  )
export type LearningSummary = z.infer<typeof learningSummarySchema>
export const savedLearningSummarySchema = z.strictObject({
  content: learningSummarySchema,
  explanationId: z.uuid(),
  createdAt: z.iso.datetime(),
})
export type SavedLearningSummary = z.infer<typeof savedLearningSummarySchema>
