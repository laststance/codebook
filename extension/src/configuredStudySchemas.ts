import { z } from 'zod';
import {
  BOOK_MAX_ANCHORS, CONFIGURED_CAPTURE_PHASES, CONFIGURED_OBSERVATION_LIMIT, CONFIGURED_STUDY_VERSION,
  KEY_LENGTH_LIMIT, MAX_EXPLANATIONS, MAX_UI_TEXT_CHARS, REFERENCE_LENGTH_LIMIT, REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE, REPOSITORY_INSPECTION_LIMIT, REPOSITORY_LITERAL_LIMIT_CHARS,
} from './constants';
import { citationContextSchema } from './citationSchemas';
import { repositoryItemSchema } from './identitySchemas';
import { sourceSchema, studyIdSchema } from './legacyStudySchemas';
import { inspectionPathSchema, repositoryConfigSchema } from './repositoryConfigSchemas';
import { repositorySourceSchema } from './repositorySchemas';
import { bookAnchorSchema, repositoryHashSchema } from './sourceSchemas';
import { capturedImageSchema, selectionSchema } from './studySchemas';

const shortText = z.string().min(1).max(REFERENCE_LENGTH_LIMIT);
export const configuredPauseSchema = z.strictObject({ sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT), threadId: z.number().int().nonnegative(), generation: z.number().int().positive() });
export const configuredFactPathSchema = z.string().refine(value => {
  const [mode, path, extra] = value.split(':');
  return (mode === 'value' || mode === 'type') && extra === undefined && inspectionPathSchema.safeParse(path).success;
}, 'Use a declared value:<path> or type:<path> inspection.');
export const configuredFactValueSchema = z.union([z.string().max(REPOSITORY_LITERAL_LIMIT_CHARS), z.number().finite(), z.boolean(), z.null()]);
export const configuredDescriptorSchema = z.strictObject({
  itemId: repositoryItemSchema,
  anchors: z.array(bookAnchorSchema).min(1).max(BOOK_MAX_ANCHORS), citationContext: citationContextSchema,
  sources: z.array(repositorySourceSchema).min(1).max(BOOK_MAX_ANCHORS),
});
export const configuredObservationSchema = z.strictObject({
  id: shortText, itemId: repositoryItemSchema, actionId: z.literal(REPOSITORY_BROWSER_ACTION), capturePhase: z.literal('paused-browser'),
  snapshotUri: shortText, participant: z.literal('browser'), capturedAt: z.iso.datetime(), elapsedMs: z.number().finite().nonnegative(),
  pause: configuredPauseSchema,
  source: sourceSchema.extend({ column: z.number().int().positive(), javascriptHash: repositoryHashSchema, mapHash: repositoryHashSchema,
    scriptId: shortText, scriptUrl: shortText, generated: z.strictObject({ line: z.number().int().nonnegative(), column: z.number().int().nonnegative() }) }),
  values: z.record(configuredFactPathSchema, configuredFactValueSchema),
  unavailableValues: z.array(z.strictObject({ path: configuredFactPathSchema, reason: z.string().min(1).max(MAX_UI_TEXT_CHARS) })).max(REPOSITORY_INSPECTION_LIMIT),
  interpretations: z.array(z.strictObject({ id: z.uuid(), text: z.string().max(MAX_UI_TEXT_CHARS), createdAt: z.iso.datetime(),
    facts: z.array(z.strictObject({ path: configuredFactPathSchema, value: configuredFactValueSchema })).min(1).max(REPOSITORY_INSPECTION_LIMIT) })).max(MAX_EXPLANATIONS),
});
const configuredPhaseSchema = z.enum(CONFIGURED_CAPTURE_PHASES);
export const configuredImageSchema = z.discriminatedUnion('status', [
  capturedImageSchema.options[0].extend({ phase: configuredPhaseSchema }),
  capturedImageSchema.options[1].extend({ phase: configuredPhaseSchema }),
]);
export const configuredStudySchema = z.strictObject({
  version: z.literal(CONFIGURED_STUDY_VERSION), workspaceKey: repositoryHashSchema, id: studyIdSchema, instanceId: z.uuid(), runId: z.uuid(), profile: z.literal(REPOSITORY_BROWSER_PROFILE),
  createdAt: z.iso.datetime(), savedAt: z.iso.datetime(), state: shortText, terminal: z.boolean(),
  finalOutcome: z.enum(['pending-teardown', 'demonstrated', 'not-demonstrated', 'partial']), reason: z.string().max(MAX_UI_TEXT_CHARS).optional(), materialSignature: repositoryHashSchema,
  configuration: repositoryConfigSchema, configurationHash: repositoryHashSchema, descriptor: configuredDescriptorSchema.optional(),
  operation: z.strictObject({ id: z.uuid(), key: z.string().min(1).max(KEY_LENGTH_LIMIT), inputDispatched: z.boolean(), inputAcknowledged: z.boolean(), continuedPause: configuredPauseSchema.optional(), afterVerified: z.boolean() }).optional(),
  observations: z.array(configuredObservationSchema).max(CONFIGURED_OBSERVATION_LIMIT), captures: z.array(configuredImageSchema).max(CONFIGURED_CAPTURE_PHASES.length),
  // Browser-only evidence has no declared cross-runtime causal links.
  links: z.array(z.never()).max(0),
});
export const configuredStudyMetadataSchema = configuredStudySchema.pick({ version: true, workspaceKey: true, id: true, profile: true, createdAt: true, savedAt: true, state: true, terminal: true, finalOutcome: true, materialSignature: true })
  .extend({ archive: z.strictObject({ byteLength: z.number().int().positive(), modifiedMs: z.number().nonnegative(), hash: repositoryHashSchema }) });
export const configuredSelectionSchema = z.strictObject({ ...selectionSchema.shape,
  studyId: studyIdSchema, profile: z.literal(REPOSITORY_BROWSER_PROFILE), itemId: repositoryItemSchema });
export type ConfiguredStudy = z.infer<typeof configuredStudySchema>;
export type ConfiguredObservation = z.infer<typeof configuredObservationSchema>;
export type ConfiguredDescriptor = z.infer<typeof configuredDescriptorSchema>;
export type ConfiguredFactValue = z.infer<typeof configuredFactValueSchema>;
