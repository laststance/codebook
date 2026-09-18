import { z } from 'zod';
import { CAPTURE_PHASES, IMAGE_BASE64_LIMIT_CHARS, KEY_LENGTH_LIMIT, LEARNING_SCHEMA_VERSION, MAX_EXPLANATIONS, MAX_LEARNER_DECISIONS, MAX_STUDY_LINKS, MAX_STUDY_OBSERVATIONS, MAX_UI_TEXT_CHARS, PROFILE_ID, REFERENCE_LENGTH_LIMIT, SOURCE_LIMIT_BYTES, VALUE_PATHS } from './constants';

// Frozen version-1 decoder. Its bounds, participant identities and fact paths remain independent of version 2.
export const participantSchema = z.enum(['server', 'browser']);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const shortText = z.string().min(1).max(REFERENCE_LENGTH_LIMIT);
export const studyIdSchema = z.string().regex(/^[a-f0-9-]{36}_[a-f0-9-]{36}$/);
export const sourceSchema = z.strictObject({ text: z.string().max(SOURCE_LIMIT_BYTES), hash: hashSchema, line: z.number().int().positive() });
const phaseShape = { phase: z.enum(CAPTURE_PHASES) };
export const capturedImageSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...phaseShape, status: z.literal('captured'), base64: z.string().max(IMAGE_BASE64_LIMIT_CHARS), hash: hashSchema }),
  z.strictObject({ ...phaseShape, status: z.enum(['pending', 'failed', 'absent']), reason: z.string().max(MAX_UI_TEXT_CHARS) }),
]);
const valuesSchema = z.strictObject({ operationId: shortText, cartId: shortText, productId: shortText, price: z.number(), cartCount: z.number().int().nonnegative(), admittedCount: z.number().int().nonnegative() });
export const observationSchema = z.strictObject({
  id: shortText, snapshotUri: shortText, participant: participantSchema, capturedAt: z.iso.datetime(), elapsedMs: z.number().nonnegative(),
  pause: z.strictObject({ sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT), threadId: z.number().int().nonnegative(), generation: z.number().int().positive() }), source: sourceSchema, values: valuesSchema,
  interpretations: z.array(z.strictObject({ id: z.uuid(), text: z.string().max(MAX_UI_TEXT_CHARS), createdAt: z.iso.datetime(), facts: z.array(z.strictObject({ path: z.enum(VALUE_PATHS), value: z.union([z.string().max(KEY_LENGTH_LIMIT), z.number()]) })).max(VALUE_PATHS.length) })).max(MAX_EXPLANATIONS),
});
export const studyArchiveSchema = z.strictObject({
  version: z.literal(LEARNING_SCHEMA_VERSION), workspaceKey: hashSchema, id: studyIdSchema, instanceId: z.uuid(), runId: z.uuid(), profile: z.literal(PROFILE_ID),
  createdAt: z.iso.datetime(), savedAt: z.iso.datetime(), state: shortText, terminal: z.boolean(), finalOutcome: shortText, reason: z.string().max(MAX_UI_TEXT_CHARS).optional(),
  observations: z.array(observationSchema).max(MAX_STUDY_OBSERVATIONS), captures: z.array(capturedImageSchema).max(CAPTURE_PHASES.length),
  links: z.array(z.strictObject({ id: shortText, status: z.enum(['unknown', 'observed', 'ambiguous', 'mismatched']) })).max(MAX_STUDY_LINKS),
});
export const learnerDecisionSchema = z.strictObject({ id: z.uuid(), item: participantSchema, sourceHash: hashSchema, understood: z.boolean(), at: z.iso.datetime() });
export const selectionSchema = z.strictObject({ studyId: studyIdSchema.optional(), participant: participantSchema, follow: z.boolean(), tab: z.enum(['overview', 'live']) });
export const progressSchema = z.strictObject({ version: z.literal(LEARNING_SCHEMA_VERSION), workspaceKey: hashSchema, decisions: z.array(learnerDecisionSchema).max(MAX_LEARNER_DECISIONS), selection: selectionSchema.optional() });
