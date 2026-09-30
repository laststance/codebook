import { z } from 'zod'

import { configuredDescriptorSchema } from './configuredStudySchemas'
import {
  LEARNING_SUMMARY_LIMITS,
  MAX_EXPLANATION_CHARS,
  NODE_TEST_FACT_TYPE_LIMIT_CHARS,
  NODE_TEST_HISTORY_MAX_ENTRIES,
  NODE_TEST_HISTORY_VERSION,
  NODE_TEST_LEARNING_DECISION_VERSION,
  NODE_TEST_LEARNING_MATERIAL_VERSION,
  NODE_TEST_READER_POSITION_VERSION,
  REPOSITORY_PATH_LIMIT_CHARS,
  REPOSITORY_LITERAL_LIMIT_CHARS,
  NODE_TEST_PROFILE,
} from './constants'
import { studyIdSchema } from './legacyStudySchemas'
import { nodeTestConfigSchema } from './nodeTestConfigSchemas'
import { replayDebugSnapshotSchema } from './replayDebugSchemas'
import { repositoryHashSchema } from './sourceSchemas'

const elapsed = z.number().finite().nonnegative()
const base = {
  sequence: z.number().int().positive().max(NODE_TEST_HISTORY_MAX_ENTRIES),
  elapsedMs: elapsed,
}
const source = z.strictObject({
  path: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
  hash: repositoryHashSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
})
const fact = z.strictObject({
  path: z.string().min(1).max(256),
  mode: z.enum(['value', 'type']),
  display: z.string().max(REPOSITORY_LITERAL_LIMIT_CHARS),
  type: z.string().max(NODE_TEST_FACT_TYPE_LIMIT_CHARS).optional(),
})

export const nodeTestHistoryHeaderSchema = z
  .strictObject({
    version: z.literal(NODE_TEST_HISTORY_VERSION),
    profile: z.literal(NODE_TEST_PROFILE),
    workspaceKey: repositoryHashSchema,
    studyId: studyIdSchema,
    instanceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    configurationHash: repositoryHashSchema,
    configuration: nodeTestConfigSchema,
    descriptor: configuredDescriptorSchema,
    sourceBuild: z.strictObject({
      revision: z.string().min(1).max(1_024),
      dirty: z.boolean(),
      sourceHash: repositoryHashSchema,
    }),
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Node history identity differs from its run.',
  )

export const nodeTestHistoryEntrySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('output'),
    ...base,
    outputSequence: z
      .number()
      .int()
      .positive()
      .max(NODE_TEST_HISTORY_MAX_ENTRIES),
    channel: z.enum(['stdout', 'stderr']),
    text: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    type: z.literal('stop'),
    ...base,
    index: z.number().int().nonnegative().max(7),
    source,
    frame: z.strictObject({
      name: z.string().max(2_048),
      line: z.number().int().positive(),
      column: z.number().int().positive(),
    }),
    facts: z.array(fact).max(10),
    debuggerSnapshot: replayDebugSnapshotSchema,
  }),
  z.strictObject({
    type: z.literal('result'),
    ...base,
    exitCode: z.number().int().nullable(),
    signal: z.string().max(32).nullable(),
    outputTail: z.string().max(32_768),
  }),
])

export const nodeTestHistorySealSchema = z.strictObject({
  version: z.literal(NODE_TEST_HISTORY_VERSION),
  studyId: studyIdSchema,
  entryCount: z.number().int().nonnegative().max(NODE_TEST_HISTORY_MAX_ENTRIES),
  journalBytes: z.number().int().nonnegative().max(8_388_608),
  journalHash: repositoryHashSchema,
  status: z.enum(['complete', 'partial']),
  endedAt: z.iso.datetime(),
  reason: z.string().max(1_024).optional(),
})

export const nodeTestHistoryIndexSchema = z.strictObject({
  header: nodeTestHistoryHeaderSchema,
  entries: z
    .array(nodeTestHistoryEntrySchema)
    .max(NODE_TEST_HISTORY_MAX_ENTRIES),
  seal: nodeTestHistorySealSchema.optional(),
  status: z.enum(['recording', 'complete', 'partial', 'interrupted']),
  reason: z.string().max(1_024).optional(),
})

export const nodeTestHistoryReaderPositionSchema = z.strictObject({
  version: z.literal(NODE_TEST_READER_POSITION_VERSION),
  studyId: studyIdSchema,
  sequence: z.number().int().positive().max(NODE_TEST_HISTORY_MAX_ENTRIES),
  updatedAt: z.iso.datetime(),
})

export const nodeTestHistoryLearningDecisionSchema = z.strictObject({
  version: z.literal(NODE_TEST_LEARNING_DECISION_VERSION),
  studyId: studyIdSchema,
  understood: z.boolean(),
  at: z.iso.datetime(),
})

const nodeLearningStepIdSchema = z
  .string()
  .min(1)
  .max(LEARNING_SUMMARY_LIMITS.identifierChars)
  .regex(/^[a-zA-Z0-9_-]+$/)
const nodeLearningReferenceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('stop'),
    sequence: base.sequence,
    sourceHash: repositoryHashSchema,
  }),
  z.strictObject({
    type: z.literal('output'),
    sequence: base.sequence,
    channel: z.enum(['stdout', 'stderr']),
  }),
  z.strictObject({ type: z.literal('result'), sequence: base.sequence }),
])
export const nodeTestLearningMaterialContentSchema = z
  .strictObject({
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    title: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.titleChars),
    summary: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    participants: z
      .array(
        z.strictObject({
          id: nodeLearningStepIdSchema,
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
          id: nodeLearningStepIdSchema,
          from: nodeLearningStepIdSchema,
          to: nodeLearningStepIdSchema,
          label: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.stepLabelChars),
          explanation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
          evidence: z.enum(['observed', 'source-derived', 'unknown']),
          reference: nodeLearningReferenceSchema.optional(),
        }),
      )
      .min(1)
      .max(LEARNING_SUMMARY_LIMITS.steps),
  })
  .refine((value) => {
    const participantIds = new Set(
      value.participants.map((participant) => participant.id),
    )
    return (
      participantIds.size === value.participants.length &&
      new Set(value.steps.map((step) => step.id)).size === value.steps.length &&
      value.steps.every(
        (step) =>
          participantIds.has(step.from) &&
          participantIds.has(step.to) &&
          (step.evidence === 'unknown' || step.reference),
      )
    )
  }, 'Use unique participant/step IDs, declared participants and a verified Node history reference for every observed or source-derived step.')
  .refine(
    (value) =>
      Buffer.byteLength(JSON.stringify(value), 'utf8') <=
      LEARNING_SUMMARY_LIMITS.bytes,
    'Node learning material exceeds its total byte limit.',
  )
export const nodeTestLearningMaterialSchema = z.strictObject({
  version: z.literal(NODE_TEST_LEARNING_MATERIAL_VERSION),
  studyId: studyIdSchema,
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  content: nodeTestLearningMaterialContentSchema,
})

export type NodeTestHistoryHeader = z.infer<typeof nodeTestHistoryHeaderSchema>
export type NodeTestHistoryEntry = z.infer<typeof nodeTestHistoryEntrySchema>
export type NodeTestHistoryIndex = z.infer<typeof nodeTestHistoryIndexSchema>
export type NodeTestHistoryReaderPosition = z.infer<
  typeof nodeTestHistoryReaderPositionSchema
>
export type NodeTestHistoryLearningDecision = z.infer<
  typeof nodeTestHistoryLearningDecisionSchema
>
export type NodeTestLearningMaterialContent = z.infer<
  typeof nodeTestLearningMaterialContentSchema
>
export type NodeTestLearningMaterial = z.infer<
  typeof nodeTestLearningMaterialSchema
>
