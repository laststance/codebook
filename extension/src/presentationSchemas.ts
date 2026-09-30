import { z } from 'zod'

import {
  PRESENTATION_MODE_IDS,
  PRESENTATION_PREFERENCE_VERSION,
  PRESENTATION_READING_LIMIT_PX,
  PRESENTATION_FOCUS_INDEX_LIMIT,
  PRESENTATION_READING_ANCHORS,
  PRESENTATION_READING_DETAILS,
  PRESENTATION_READING_VISITED,
  PRESENTATION_FOCUS_IDS,
  PRESENTATION_FOCUS_ACTIONS,
  REFERENCE_LENGTH_LIMIT,
} from './constants'
import { learningItemSchema } from './identitySchemas'
import { learningStepIdSchema } from './learningSummarySchemas'
import { studyIdSchema } from './legacyStudySchemas'

export const presentationModeSchema = z.enum(PRESENTATION_MODE_IDS)
export type PresentationMode = z.infer<typeof presentationModeSchema>
export const presentationPreferenceSchema = z.strictObject({
  version: z.literal(PRESENTATION_PREFERENCE_VERSION),
  mode: presentationModeSchema,
})
export const presentationCommandSchema = z.strictObject({
  instanceId: z.uuid(),
  presentationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mode: presentationModeSchema,
  action: z
    .enum(['select', 'restore', 'save-preference', 'focus'])
    .default('select'),
})
export type PresentationCommand = z.infer<typeof presentationCommandSchema>
export type PresentationIntent = Omit<PresentationCommand, 'instanceId'>
export const returnCurrentCommandSchema = z.strictObject({
  instanceId: z.uuid(),
  presentationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
})
export type ReturnCurrentCommand = z.infer<typeof returnCurrentCommandSchema>
export type ReturnCurrentIntent = Omit<ReturnCurrentCommand, 'instanceId'>
const readingOffsetSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(PRESENTATION_READING_LIMIT_PX)
export const presentationReadingPoseSchema = z.strictObject({
  anchorId: z.enum(PRESENTATION_READING_ANCHORS).optional(),
  fraction: z.number().min(0).max(1),
  leadingOffsetPx: readingOffsetSchema,
  scrollY: readingOffsetSchema,
  valuesScrollLeft: readingOffsetSchema,
  expanded: z
    .array(z.enum(PRESENTATION_READING_DETAILS))
    .max(PRESENTATION_READING_DETAILS.length),
  visited: z
    .array(z.enum(PRESENTATION_READING_VISITED))
    .max(PRESENTATION_READING_VISITED.length),
  focus: z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('id'),
        id: z.enum(PRESENTATION_FOCUS_IDS),
      }),
      z.strictObject({
        kind: z.literal('summary'),
        id: z.enum(PRESENTATION_READING_DETAILS),
      }),
      z.strictObject({
        kind: z.literal('action'),
        action: z.enum(PRESENTATION_FOCUS_ACTIONS),
        index: z
          .number()
          .int()
          .nonnegative()
          .max(PRESENTATION_FOCUS_INDEX_LIMIT),
      }),
      z.strictObject({
        kind: z.literal('presentation'),
        action: z.enum(['restore', 'save-preference']),
      }),
      z.strictObject({ kind: z.literal('playback-start') }),
      z.strictObject({
        kind: z.literal('summary-step'),
        id: learningStepIdSchema,
      }),
      z.strictObject({ kind: z.literal('values') }),
      z.strictObject({
        kind: z.literal('item'),
        region: z.enum(['flow', 'moments']),
        itemId: learningItemSchema,
        observationId: z.string().min(1).max(REFERENCE_LENGTH_LIMIT).optional(),
      }),
    ])
    .optional(),
})
export type PresentationReadingPose = z.infer<
  typeof presentationReadingPoseSchema
>
const presentationPoseIdentity = {
  captureId: z.uuid(),
  presentationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  itemId: learningItemSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  studyId: studyIdSchema.optional(),
  observationId: z.string().min(1).max(REFERENCE_LENGTH_LIMIT).optional(),
  contentTab: z.enum(['overview', 'live', 'recording']),
}
export const presentationPoseCaptureSchema = z.strictObject({
  type: z.literal('capture-presentation-pose'),
  ...presentationPoseIdentity,
})
export type PresentationPoseCapture = z.infer<
  typeof presentationPoseCaptureSchema
>
export const presentationPoseSchema = z.strictObject({
  type: z.literal('presentation-pose'),
  ...presentationPoseIdentity,
  pose: presentationReadingPoseSchema,
})
export type PresentationPose = z.infer<typeof presentationPoseSchema>
export type PresentationPoseRestore = Omit<PresentationPose, 'type'> & {
  type: 'restore-presentation-pose'
}
export const presentationPoseRestoredSchema = z.strictObject({
  type: z.literal('presentation-pose-restored'),
  captureId: z.uuid(),
})
export const presentationPoseInvalidatedSchema = z.strictObject({
  type: z.literal('presentation-pose-invalidated'),
  captureId: z.uuid(),
})
export interface PresentationState {
  presentationId: string
  presentationControlRevision: number
  reader: {
    contentRevision: number
    contentTab: 'overview' | 'live' | 'recording'
    followingCurrentRun: boolean
  }
  mode: PresentationMode
  requestedMode?: PresentationMode
  state: 'closed' | 'open' | 'applying'
  layoutConfirmed: boolean
  preference: {
    status: 'default' | 'saved' | 'saving' | 'failed' | 'unknown'
    mode?: PresentationMode
    reason?: string
  }
  reason?: string
  playbackRevision?: number
  panes: { appColumn?: number; sourceColumn?: number; contextColumn?: number }
}
