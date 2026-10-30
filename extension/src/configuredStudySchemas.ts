import { z } from 'zod'

import { citationContextSchema } from './citationSchemas'
import {
  BOOK_MAX_ANCHORS,
  CONFIGURED_CAPTURE_PHASES,
  CROSS_RUNTIME_CAPTURE_PHASES,
  CROSS_RUNTIME_STUDY_VERSION,
  VITE_STUDY_VERSION,
  CONFIGURED_OBSERVATION_LIMIT,
  CONFIGURED_STUDY_VERSION,
  KEY_LENGTH_LIMIT,
  MAX_EXPLANATIONS,
  MAX_UI_TEXT_CHARS,
  REFERENCE_LENGTH_LIMIT,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_LITERAL_LIMIT_CHARS,
} from './constants'
import { repositoryItemSchema } from './identitySchemas'
import { savedLearningSummarySchema } from './learningSummarySchemas'
import { sourceSchema, studyIdSchema } from './legacyStudySchemas'
import { replayDebugSnapshotSchema } from './replayDebugSchemas'
import {
  inspectionPathSchema,
  retainedRepositoryConfigSchema,
} from './repositoryConfigSchemas'
import {
  bookDocumentSchema,
  bookNodeSchema,
  repositorySourceSchema,
} from './repositorySchemas'
import { bookAnchorSchema, repositoryHashSchema } from './sourceSchemas'
import { capturedImageSchema, selectionSchema } from './studySchemas'

const shortText = z.string().min(1).max(REFERENCE_LENGTH_LIMIT)
export const configuredPauseSchema = z.strictObject({
  sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT),
  threadId: z.number().int().nonnegative(),
  generation: z.number().int().positive(),
})
export const configuredFactPathSchema = z.string().refine((value) => {
  const [mode, path, extra] = value.split(':')
  return (
    (mode === 'value' || mode === 'type') &&
    extra === undefined &&
    inspectionPathSchema.safeParse(path).success
  )
}, 'Use a declared value:<path> or type:<path> inspection.')
// JSON preserves this marker as observed undefined, distinct from missing facts and the literal string.
export const configuredFactValueSchema = z.union([
  z.string().max(REPOSITORY_LITERAL_LIMIT_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
  // Markers for a value that is not a bounded primitive: undefined itself, and an object or function whose members are not captured.
  z.strictObject({ type: z.enum(['undefined', 'object', 'function']) }),
])
export const configuredDescriptorSchema = z.strictObject({
  itemId: repositoryItemSchema,
  bookTitle: bookDocumentSchema.shape.title,
  nodeTitle: bookNodeSchema.shape.title,
  anchors: z.array(bookAnchorSchema).min(1).max(BOOK_MAX_ANCHORS),
  citationContext: citationContextSchema,
  sources: z.array(repositorySourceSchema).min(1).max(BOOK_MAX_ANCHORS),
})
export const configuredObservationSchema = z.strictObject({
  id: shortText,
  itemId: repositoryItemSchema,
  actionId: z.literal(REPOSITORY_BROWSER_ACTION),
  capturePhase: z.enum(['paused-browser', 'paused-server']),
  snapshotUri: shortText,
  participant: z.enum(['browser', 'server']),
  capturedAt: z.iso.datetime(),
  elapsedMs: z.number().finite().nonnegative(),
  pause: configuredPauseSchema,
  source: sourceSchema.extend({
    column: z.number().int().positive(),
    javascriptHash: repositoryHashSchema,
    mapHash: repositoryHashSchema,
    scriptId: shortText,
    scriptUrl: shortText,
    generated: z.strictObject({
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    }),
    // The run's receipt that its binding rule held when it committed the stop: no line between the two had a mapped position or, once the run had read the debugger's break locations, a break location between the two generated places of the request and the binding (`mappedLinesBetween` stays 0 in both cases). A saved study has no sealed map to repeat that check with; studies saved by 0.2.27 and older carry none.
    binding: z
      .strictObject({
        declaredLine: z.number().int().positive(),
        // Present only for a stop declared on a line without a mapped position: the first mapped line after it, where its breakpoint was requested and from which the rule was measured.
        requestedLine: z.number().int().positive().optional(),
        boundLine: z.number().int().positive(),
        mappedLinesBetween: z.literal(0),
      })
      .optional(),
  }),
  values: z.record(configuredFactPathSchema, configuredFactValueSchema),
  debugger: replayDebugSnapshotSchema.optional(),
  unavailableValues: z
    .array(
      z.strictObject({
        path: configuredFactPathSchema,
        reason: z.string().min(1).max(MAX_UI_TEXT_CHARS),
      }),
    )
    .max(REPOSITORY_INSPECTION_LIMIT),
  interpretations: z
    .array(
      z.strictObject({
        id: z.uuid(),
        text: z.string().max(MAX_UI_TEXT_CHARS),
        createdAt: z.iso.datetime(),
        facts: z
          .array(
            z.strictObject({
              path: configuredFactPathSchema,
              value: configuredFactValueSchema,
            }),
          )
          .min(1)
          .max(REPOSITORY_INSPECTION_LIMIT),
      }),
    )
    .max(MAX_EXPLANATIONS),
})
const configuredPhaseSchema = z.enum(CROSS_RUNTIME_CAPTURE_PHASES)
export const configuredImageSchema = z.discriminatedUnion('status', [
  capturedImageSchema.options[0].extend({
    phase: configuredPhaseSchema,
    snapshotId: shortText.optional(),
  }),
  capturedImageSchema.options[1].extend({
    phase: configuredPhaseSchema,
    snapshotId: shortText.optional(),
  }),
])
export const configuredStudySchema = z.strictObject({
  version: z.union([
    z.literal(CONFIGURED_STUDY_VERSION),
    z.literal(CROSS_RUNTIME_STUDY_VERSION),
    z.literal(VITE_STUDY_VERSION),
  ]),
  workspaceKey: repositoryHashSchema,
  id: studyIdSchema,
  instanceId: z.uuid(),
  runId: z.uuid(),
  profile: z.literal(REPOSITORY_BROWSER_PROFILE),
  createdAt: z.iso.datetime(),
  savedAt: z.iso.datetime(),
  state: shortText,
  terminal: z.boolean(),
  finalOutcome: z.enum([
    'pending-teardown',
    'demonstrated',
    'not-demonstrated',
    'partial',
  ]),
  reason: z.string().max(MAX_UI_TEXT_CHARS).optional(),
  materialSignature: repositoryHashSchema,
  configuration: retainedRepositoryConfigSchema,
  configurationHash: repositoryHashSchema,
  descriptor: configuredDescriptorSchema.optional(),
  // The Vite version a `vite-dev` run started on (read from the resolved `vite/package.json`); a Next study has none.
  viteVersion: z.string().min(1).max(64).optional(),
  operation: z
    .strictObject({
      id: z.uuid(),
      key: z.string().min(1).max(KEY_LENGTH_LIMIT),
      inputDispatched: z.boolean(),
      inputAcknowledged: z.boolean(),
      continuedPause: configuredPauseSchema.optional(),
      afterVerified: z.boolean(),
    })
    .optional(),
  learningSummary: savedLearningSummarySchema.optional(),
  observations: z
    .array(configuredObservationSchema)
    .max(CONFIGURED_OBSERVATION_LIMIT),
  captures: z
    .array(configuredImageSchema)
    .max(CONFIGURED_CAPTURE_PHASES.length - 1 + CONFIGURED_OBSERVATION_LIMIT),
  // Chronological stops alone do not prove a cross-runtime causal link.
  links: z.array(z.never()).max(0),
})
export const configuredStudyMetadataSchema = configuredStudySchema
  .pick({
    version: true,
    workspaceKey: true,
    id: true,
    profile: true,
    createdAt: true,
    savedAt: true,
    state: true,
    terminal: true,
    finalOutcome: true,
    materialSignature: true,
  })
  .extend({
    archive: z.strictObject({
      byteLength: z.number().int().positive(),
      modifiedMs: z.number().nonnegative(),
      hash: repositoryHashSchema,
    }),
  })
export const configuredSelectionSchema = z.strictObject({
  ...selectionSchema.shape,
  studyId: studyIdSchema.optional(),
  profile: z.literal(REPOSITORY_BROWSER_PROFILE),
  itemId: repositoryItemSchema,
})
export const configuredDefinitionSchema = configuredStudySchema
  .pick({ configuration: true, configurationHash: true, descriptor: true })
  .extend({ descriptor: configuredDescriptorSchema })
export type ConfiguredStudy = z.infer<typeof configuredStudySchema>
export type ConfiguredObservation = z.infer<typeof configuredObservationSchema>
export type ConfiguredDescriptor = z.infer<typeof configuredDescriptorSchema>
export type ConfiguredFactValue = z.infer<typeof configuredFactValueSchema>
export type ConfiguredDefinition = z.infer<typeof configuredDefinitionSchema>
