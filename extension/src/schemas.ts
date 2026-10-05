import { z } from 'zod'

import { configuredFactPathSchema } from './configuredStudySchemas'
import {
  NODE_TEST_PROFILE,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  KEY_LENGTH_LIMIT,
  MAX_EXPLANATION_CHARS,
  MAX_VALUE_PATHS,
  REFERENCE_LENGTH_LIMIT,
} from './constants'
import { learningSummarySchema } from './learningSummarySchemas'
import { studyIdSchema } from './legacyStudySchemas'
import { nodeTestConfigSchema } from './nodeTestConfigSchemas'
import { nodeTestLearningMaterialContentSchema } from './nodeTestHistorySchemas'
import {
  inspectionPathSchema,
  retainedRepositoryConfigSchema,
} from './repositoryConfigSchemas'

const instanceShape = { instanceId: z.uuid() }
const runShape = { ...instanceShape, runId: z.uuid() }
const key = z.string().min(1).max(KEY_LENGTH_LIMIT)
// MCP requires an object root; the service resolves its closed domain variant before reserving any effects.
export const startSchema = z.strictObject({
  ...instanceShape,
  profile: z.string().min(1).max(KEY_LENGTH_LIMIT),
  key,
  configuration: z
    .union([retainedRepositoryConfigSchema, nodeTestConfigSchema])
    .optional(),
})
export const startIntentSchema = z.discriminatedUnion('profile', [
  z.strictObject({
    ...instanceShape,
    profile: z.literal(REPOSITORY_BROWSER_PROFILE),
    key,
    configuration: retainedRepositoryConfigSchema,
  }),
  z.strictObject({
    ...instanceShape,
    profile: z.literal(NODE_TEST_PROFILE),
    key,
    configuration: nodeTestConfigSchema,
  }),
])
export const runSchema = z.strictObject(runShape)
export const actionSchema = z.strictObject({
  ...runShape,
  key,
  action: z.literal(REPOSITORY_BROWSER_ACTION),
})
export const continueSchema = z.strictObject({
  ...runShape,
  participant: z.enum(['server', 'browser']),
  sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT),
  threadId: z.number().int().nonnegative(),
  generation: z.number().int().positive(),
  answer: z
    .literal('next')
    .optional()
    .describe(
      'Optional; the run resource\'s continueArguments carry it. With "next" the call answers when the run committed its next pause, observed its result or ended, and returns the run\'s state beside accepted; next names which. Without it the call answers as soon as the continuation is acknowledged.',
    ),
})
export const revealSchema = z.strictObject({
  ...runShape,
  snapshotUri: z.string().max(REFERENCE_LENGTH_LIMIT),
})
// The tool's own path: the saved format keeps configuredFactPathSchema, and the service saves a bare path under its captured key.
const explainValuePathSchema = z
  .string()
  .refine(
    (value) =>
      configuredFactPathSchema.safeParse(value).success ||
      inspectionPathSchema.safeParse(value).success,
    'Use a captured fact key, value:<path> or type:<path>, or the path alone when the snapshot captured one fact with that path.',
  )
  .describe(
    'A captured fact key of this snapshot: value:<path> or type:<path>. The path alone is accepted when exactly one captured fact of the snapshot has that path, and the explanation is saved under that key.',
  )
export const explainSchema = z.strictObject({
  ...runShape,
  key,
  snapshotUri: z.string().max(REFERENCE_LENGTH_LIMIT),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  valuePaths: z.array(explainValuePathSchema).min(1).max(MAX_VALUE_PATHS),
  interpretation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
  learningSummary: learningSummarySchema.optional(),
})
export const explainNodeHistorySchema = z.strictObject({
  studyId: studyIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  content: nodeTestLearningMaterialContentSchema,
})
export type StartIntent = z.infer<typeof startIntentSchema>
export type StartInput = z.infer<typeof startSchema>
export type ActionInput = z.infer<typeof actionSchema>
export type ContinueInput = z.infer<typeof continueSchema>
export type RunInput = z.infer<typeof runSchema>
export type RevealInput = z.infer<typeof revealSchema>
export type ExplainInput = z.infer<typeof explainSchema>
export type ExplainNodeHistoryInput = z.infer<typeof explainNodeHistorySchema>
