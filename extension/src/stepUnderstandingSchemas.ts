import { z } from 'zod'

import { STEP_UNDERSTANDING_MAX_DECISIONS } from './constants'
import { learningStepIdSchema } from './learningSummarySchemas'
import { studyIdSchema } from './legacyStudySchemas'

/** One decision of the learner about one step of one version of a saved replay's material: the step's id, the hash of the step as it was saved, whether the learner marked it understood, and when. */
const stepUnderstandingDecisionSchema = z.strictObject({
  stepId: learningStepIdSchema,
  stepHash: z.string().regex(/^[a-f0-9]{64}$/),
  understood: z.boolean(),
  at: z.iso.datetime(),
})

/**
 * The step-understanding file of one saved replay (version 1): the learner's per-step decisions, written only by the learner's press and read by {@link LearningLibrary} and {@link NodeHistoryStore} when a replay opens.
 * @example stepUnderstandingFileSchema.parse({ version: 1, studyId, decisions: [] })
 */
export const stepUnderstandingFileSchema = z.strictObject({
  version: z.literal(1),
  studyId: studyIdSchema,
  decisions: z
    .array(stepUnderstandingDecisionSchema)
    .max(STEP_UNDERSTANDING_MAX_DECISIONS),
})

/** One decision, as {@link stepUnderstandingDecisionSchema} parses it. */
export type StepUnderstandingDecision = z.infer<
  typeof stepUnderstandingDecisionSchema
>
/** A replay's step-understanding file, as {@link stepUnderstandingFileSchema} parses it. */
export type StepUnderstandingFile = z.infer<typeof stepUnderstandingFileSchema>
