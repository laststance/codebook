import {
  CONFIGURED_OBSERVATION_LIMIT,
  CROSS_RUNTIME_CAPTURE_PHASES,
  CROSS_RUNTIME_RECORDING_VERSION,
} from './constants'
import { z } from 'zod'
import {
  CONFIGURED_CAPTURE_PHASES,
  CONFIGURED_RECORDING_VERSION,
  IMAGE_LIMIT_BYTES,
  MAX_EXPLANATIONS,
  MAX_RECORDING_DIMENSION_PX,
  MAX_RECORDING_FRAMES,
  MAX_RECORDING_JOURNAL_BYTES,
  MAX_RECORDING_PNG_BYTES,
  MAX_STUDY_CAPTURES_V2,
  MAX_STUDY_OBSERVATIONS_V2,
  RECORDING_REASON_LIMIT_CHARS,
  RECORDING_VERSION,
  REFERENCE_LENGTH_LIMIT,
  REPOSITORY_BROWSER_PROFILE,
} from './constants'
import { studyIdSchema } from './legacyStudySchemas'
import { capturePhaseSchema, profileSchema } from './studySchemas'
import { configuredStudySchema } from './configuredStudySchemas'

export const recordingHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const elapsed = z.number().finite().nonnegative()
const reason = z.string().min(1).max(RECORDING_REASON_LIMIT_CHARS)
const sequence = z
  .number()
  .int()
  .positive()
  .max(MAX_RECORDING_FRAMES + 2)
export const recordingBindingSchema = z
  .strictObject({
    workspaceKey: recordingHashSchema,
    studyId: studyIdSchema,
    instanceId: z.uuid(),
    runId: z.uuid(),
    runtimeId: z.uuid(),
    profile: profileSchema,
    sourceBuild: z.strictObject({
      revision: z.string().min(1).max(REFERENCE_LENGTH_LIMIT),
      dirty: z.boolean(),
      sourceHash: recordingHashSchema,
    }),
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Recording identity differs from its study.',
  )
export const recordingHeaderSchema = recordingBindingSchema.safeExtend({
  version: z.literal(RECORDING_VERSION),
  createdAt: z.iso.datetime(),
  startedMs: elapsed,
  clock: z.literal('runtime-receipt-ms'),
  owner: z.strictObject({
    pid: z.number().int().positive(),
    hostname: z.string().min(1).max(REFERENCE_LENGTH_LIMIT),
    sessionId: z.uuid(),
  }),
  sampleIntervalMs: elapsed,
})
export const recordingFrameSchema = z
  .strictObject({
    type: z.literal('frame'),
    sequence,
    elapsedMs: elapsed,
    hash: recordingHashSchema,
    byteLength: z.number().int().positive().max(IMAGE_LIMIT_BYTES),
    width: z.number().int().positive().max(MAX_RECORDING_DIMENSION_PX),
    height: z.number().int().positive().max(MAX_RECORDING_DIMENSION_PX),
    kind: z.enum(['stream', 'phase']),
    phase: capturePhaseSchema.optional(),
    browserTimestamp: z.number().finite().optional(),
  })
  .refine(
    (frame) =>
      frame.kind === 'phase' ? Boolean(frame.phase) : frame.phase === undefined,
    'Only explicit phase images have phase identity.',
  )
export const recordingGapSchema = z.strictObject({
  type: z.literal('gap'),
  sequence,
  elapsedMs: elapsed,
  reason,
})
export const recordingEndSchema = z.strictObject({
  type: z.literal('end'),
  sequence,
  elapsedMs: elapsed,
  status: z.enum(['complete', 'partial']),
  reason: reason.optional(),
})
export const recordingEntrySchema = z.discriminatedUnion('type', [
  recordingFrameSchema,
  recordingGapSchema,
  recordingEndSchema,
])
export const recordingSealSchema = z.strictObject({
  version: z.literal(RECORDING_VERSION),
  studyId: studyIdSchema,
  workspaceKey: recordingHashSchema,
  finalizedAt: z.iso.datetime(),
  endMs: elapsed,
  status: z.enum(['complete', 'partial']),
  reason: reason.optional(),
  frameCount: z.number().int().nonnegative().max(MAX_RECORDING_FRAMES),
  pngBytes: z.number().int().nonnegative().max(MAX_RECORDING_PNG_BYTES),
  journalBytes: z.number().int().nonnegative().max(MAX_RECORDING_JOURNAL_BYTES),
  journalHash: recordingHashSchema,
})
export const configuredRecordingBindingSchema = z
  .strictObject({
    ...recordingBindingSchema.shape,
    profile: z.literal(REPOSITORY_BROWSER_PROFILE),
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Recording identity differs from its study.',
  )
export const configuredRecordingHeaderSchema =
  configuredRecordingBindingSchema.safeExtend({
    ...recordingHeaderSchema.shape,
    profile: z.literal(REPOSITORY_BROWSER_PROFILE),
    version: z.literal(CONFIGURED_RECORDING_VERSION),
  })
export const configuredRecordingSealSchema = recordingSealSchema.extend({
  version: z.literal(CONFIGURED_RECORDING_VERSION),
})
export const crossRuntimeRecordingHeaderSchema =
  configuredRecordingBindingSchema.safeExtend({
    ...configuredRecordingHeaderSchema.shape,
    version: z.literal(CROSS_RUNTIME_RECORDING_VERSION),
  })
export const crossRuntimeRecordingSealSchema =
  configuredRecordingSealSchema.extend({
    version: z.literal(CROSS_RUNTIME_RECORDING_VERSION),
  })
export const retainedRecordingBindingSchema = configuredRecordingBindingSchema
export const retainedRecordingHeaderSchema = z.discriminatedUnion('version', [
  recordingHeaderSchema,
  configuredRecordingHeaderSchema,
  crossRuntimeRecordingHeaderSchema,
])
export const retainedRecordingSealSchema = z.discriminatedUnion('version', [
  recordingSealSchema,
  configuredRecordingSealSchema,
  crossRuntimeRecordingSealSchema,
])
export type RecordingBinding = z.infer<typeof retainedRecordingBindingSchema>
export type RecordingHeader = z.infer<typeof retainedRecordingHeaderSchema>
export type RecordingFrame = z.infer<typeof recordingFrameSchema>
export type RecordingEntry = z.infer<typeof recordingEntrySchema>
export type RecordingSeal = z.infer<typeof retainedRecordingSealSchema>
export interface RecordingIndex {
  header: RecordingHeader
  entries: RecordingEntry[]
  seal?: RecordingSeal
  status: 'recording' | 'finalized' | 'partial' | 'interrupted' | 'unfinalized'
  reason?: string
  endMs?: number
  lastVerifiedMs: number
}
export type RecordingCatalogEntry = Pick<
  RecordingIndex,
  'status' | 'reason' | 'endMs' | 'lastVerifiedMs'
> & {
  studyId: string
  profile?: RecordingHeader['profile']
  createdAt?: string
}
export const recordingContextSchema = z.strictObject({
  version: z.literal(RECORDING_VERSION),
  workspaceKey: recordingHashSchema,
  studyId: studyIdSchema,
  historyRevision: z.number().int().positive(),
  studyHash: recordingHashSchema,
  materialSignature: recordingHashSchema,
  study: configuredStudySchema.omit({ captures: true }),
  pausedIntervals: z
    .array(
      z
        .strictObject({
          snapshotId: z.string().min(1).max(REFERENCE_LENGTH_LIMIT),
          startMs: elapsed,
          endMs: elapsed,
        })
        .refine(
          (interval) => interval.endMs >= interval.startMs,
          'Invalid recorded pause interval.',
        ),
    )
    .max(MAX_STUDY_OBSERVATIONS_V2)
    .optional(),
  interpretationAvailability: z
    .array(
      z.strictObject({
        id: z.uuid(),
        snapshotId: z.string().min(1).max(REFERENCE_LENGTH_LIMIT),
        elapsedMs: elapsed.nullable(),
      }),
    )
    .max(MAX_EXPLANATIONS),
  phases: z
    .array(
      z.strictObject({
        phase: capturePhaseSchema,
        requestedMs: elapsed.optional(),
        pixelsMs: elapsed.optional(),
        hash: recordingHashSchema.optional(),
        snapshotId: z.string().min(1).max(REFERENCE_LENGTH_LIMIT).optional(),
        pauseVerifiedMs: elapsed.optional(),
        rendererConfirmedMs: elapsed.optional(),
        failedMs: elapsed.optional(),
        reason: reason.optional(),
      }),
    )
    .max(MAX_STUDY_CAPTURES_V2),
})
export const configuredRecordingContextSchema = recordingContextSchema.extend({
  version: z.literal(CONFIGURED_RECORDING_VERSION),
  study: configuredStudySchema.omit({ captures: true }),
  pausedIntervals: z
    .array(recordingContextSchema.shape.pausedIntervals.unwrap().element)
    .max(CONFIGURED_OBSERVATION_LIMIT)
    .optional(),
  phases: z
    .array(
      recordingContextSchema.shape.phases.element.extend({
        phase: z.enum(CONFIGURED_CAPTURE_PHASES),
      }),
    )
    .max(CONFIGURED_CAPTURE_PHASES.length - 1 + CONFIGURED_OBSERVATION_LIMIT),
})
export const crossRuntimeRecordingContextSchema =
  configuredRecordingContextSchema.extend({
    version: z.literal(CROSS_RUNTIME_RECORDING_VERSION),
    phases: z
      .array(
        recordingContextSchema.shape.phases.element.extend({
          phase: z.enum(CROSS_RUNTIME_CAPTURE_PHASES),
        }),
      )
      .max(CONFIGURED_CAPTURE_PHASES.length - 1 + CONFIGURED_OBSERVATION_LIMIT),
  })
export const retainedRecordingContextSchema = z.discriminatedUnion('version', [
  recordingContextSchema,
  configuredRecordingContextSchema,
  crossRuntimeRecordingContextSchema,
])
export type RecordingContext = z.infer<typeof retainedRecordingContextSchema>
