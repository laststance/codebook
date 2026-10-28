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

/**
 * Builds the steps list every learning summary and learning material has: at least one, each from one participant to another with a label, an explanation, its evidence class and the reference that backs it.
 * Shared by {@link learningSummarySchema} and the Node learning material's content schema, so the two never drift.
 * @param id - The schema of a step's and a participant's id.
 * @param referenceField - The step's reference field, already optional and described.
 * @returns The steps schema.
 * @example learningStepsSchema(learningStepIdSchema, reference.optional())
 */
export function learningStepsSchema<
  Id extends z.ZodType,
  ReferenceField extends z.ZodType,
>(id: Id, referenceField: ReferenceField) {
  return z
    .array(
      z.strictObject({
        id,
        from: id,
        to: id,
        label: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.stepLabelChars),
        explanation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
        evidence: z.enum(['observed', 'source-derived', 'unknown']),
        reference: referenceField,
      }),
    )
    .min(1)
    .max(LEARNING_SUMMARY_LIMITS.steps)
}

/**
 * Builds the participants list every learning summary and learning material has: at least one, each with an id and a label.
 * Shared by {@link learningSummarySchema} and the Node learning material's content schema, so the two never drift.
 * @param id - The schema of a participant's id.
 * @returns The participants schema.
 * @example learningParticipantsSchema(learningStepIdSchema).parse([{ id: 'ui', label: 'UI' }])
 */
export function learningParticipantsSchema<Id extends z.ZodType>(id: Id) {
  return z
    .array(
      z.strictObject({
        id,
        label: z
          .string()
          .min(1)
          .max(LEARNING_SUMMARY_LIMITS.participantLabelChars),
      }),
    )
    .min(1)
    .max(LEARNING_SUMMARY_LIMITS.participants)
}
export const learningSummarySchema = z
  .strictObject({
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    title: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.titleChars),
    summary: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    participants: learningParticipantsSchema(learningStepIdSchema),
    steps: learningStepsSchema(
      learningStepIdSchema,
      reference
        .optional()
        .describe(
          "Required for an observed or source-derived step: the snapshotUri and sourceHash of a committed observation of this run, or after the result the run's terminalReference; omit it only for an unknown step.",
        ),
    ),
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
