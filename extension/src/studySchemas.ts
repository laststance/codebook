import { z } from 'zod';
import { ACTION_IDS, CAPTURE_PHASES, PROFILE_IDS, STUDY_ITEM_IDS } from 'codebook-cycle-0004/dist/constants';
import { CAPTURED_VALUE_PATHS, IMAGE_BASE64_LIMIT_CHARS, KEY_LENGTH_LIMIT, LEARNING_SCHEMA_VERSION_V2, MAX_EXPLANATIONS, MAX_LEARNER_DECISIONS, MAX_STUDY_CAPTURES_V2, MAX_STUDY_LINKS_V2, MAX_STUDY_OBSERVATIONS_V2, MAX_UI_TEXT_CHARS, REFERENCE_LENGTH_LIMIT } from './constants';
import { participantSchema, sourceSchema, studyIdSchema } from './legacyStudySchemas';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const shortText = z.string().min(1).max(REFERENCE_LENGTH_LIMIT);
export const profileSchema = z.enum(PROFILE_IDS);
export const itemSchema = z.enum(STUDY_ITEM_IDS);
export const actionIdSchema = z.enum(ACTION_IDS);
export const capturePhaseSchema = z.enum(CAPTURE_PHASES);
export const capturedImageSchema = z.discriminatedUnion('status', [
  z.strictObject({ phase: capturePhaseSchema, status: z.literal('captured'), base64: z.string().max(IMAGE_BASE64_LIMIT_CHARS), hash }),
  z.strictObject({ phase: capturePhaseSchema, status: z.enum(['pending', 'failed', 'absent']), reason: z.string().max(MAX_UI_TEXT_CHARS) }),
]);
const cartValues = z.strictObject({ operationId: shortText, cartId: shortText, productId: shortText, price: z.number(), cartCount: z.number().int().nonnegative(), admittedCount: z.number().int().nonnegative() });
const orderValues = cartValues.extend({ cartOperationId: shortText, orderId: shortText, total: z.number(), orderCount: z.number().int().nonnegative() });
const observation = {
  id: shortText, itemId: itemSchema, capturePhase: capturePhaseSchema, snapshotUri: shortText, participant: participantSchema, capturedAt: z.iso.datetime(), elapsedMs: z.number().nonnegative(),
  pause: z.strictObject({ sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT), threadId: z.number().int().nonnegative(), generation: z.number().int().positive() }), source: sourceSchema,
  interpretations: z.array(z.strictObject({ id: z.uuid(), text: z.string().max(MAX_UI_TEXT_CHARS), createdAt: z.iso.datetime(), facts: z.array(z.strictObject({ path: z.enum(CAPTURED_VALUE_PATHS), value: z.union([z.string().max(KEY_LENGTH_LIMIT), z.number()]) })).max(CAPTURED_VALUE_PATHS.length) })).max(MAX_EXPLANATIONS),
};
export const observationSchema = z.discriminatedUnion('actionId', [
  z.strictObject({ ...observation, actionId: z.literal('add-to-cart'), values: cartValues }),
  z.strictObject({ ...observation, actionId: z.literal('checkout'), values: orderValues }),
]);
export const studyArchiveSchema = z.strictObject({
  version: z.literal(LEARNING_SCHEMA_VERSION_V2), workspaceKey: hash, id: studyIdSchema, instanceId: z.uuid(), runId: z.uuid(), profile: profileSchema,
  createdAt: z.iso.datetime(), savedAt: z.iso.datetime(), state: shortText, terminal: z.boolean(), finalOutcome: shortText, reason: z.string().max(MAX_UI_TEXT_CHARS).optional(),
  observations: z.array(observationSchema).max(MAX_STUDY_OBSERVATIONS_V2), captures: z.array(capturedImageSchema).max(MAX_STUDY_CAPTURES_V2),
  links: z.array(z.strictObject({ id: shortText, status: z.enum(['unknown', 'observed', 'ambiguous', 'mismatched']) })).max(MAX_STUDY_LINKS_V2),
});
export const learnerDecisionSchema = z.strictObject({ id: z.uuid(), item: itemSchema, sourceHash: hash, understood: z.boolean(), at: z.iso.datetime() });
export const selectionSchema = z.strictObject({ studyId: studyIdSchema.optional(), profile: profileSchema, itemId: itemSchema, follow: z.boolean(), tab: z.enum(['overview', 'live']) })
  .refine(selection => selection.itemId.startsWith(`${selection.profile}/`), 'Selection item belongs to another profile.');
export const progressSchema = z.strictObject({ version: z.literal(LEARNING_SCHEMA_VERSION_V2), workspaceKey: hash, decisions: z.array(learnerDecisionSchema).max(MAX_LEARNER_DECISIONS), selection: selectionSchema.optional() });
export type StudyArchive = z.infer<typeof studyArchiveSchema>;
export type StudySelection = z.infer<typeof selectionSchema>;
export type LearnerProgress = z.infer<typeof progressSchema>;
export type LearnerDecision = z.infer<typeof learnerDecisionSchema>;
