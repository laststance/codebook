import { z } from 'zod';
import { BOOK_MAX_ANCHORS, BOOK_MAX_SECTIONS, REPOSITORY_FIXED_READING_SECTIONS, KEY_LENGTH_LIMIT, LEARNING_SCHEMA_VERSION_V3, LEARNING_SCHEMA_VERSION_V4, MAX_LEARNER_DECISIONS } from './constants';
import { learnerDecisionSchema as legacyDecisionSchema, selectionSchema } from './studySchemas';
import { bookIdSchema, learningItemSchema } from './identitySchemas';
export { repositoryItemSchema, learningItemSchema } from './identitySchemas';
import { repositoryHashSchema } from './sourceSchemas';
import { citationContextSchema } from './citationSchemas';
import { retainedStudySelectionSchema } from './retainedStudySchemas';
import { studyIdSchema } from './legacyStudySchemas';
export { citationContextSchema } from './citationSchemas';

const singleSourceDecisionSchema = legacyDecisionSchema.extend({ context: z.strictObject({ kind: z.literal('source') }) });
const citationDecisionSchema = legacyDecisionSchema.extend({ item: learningItemSchema, context: citationContextSchema })
  .refine(decision => decision.context.anchors.some(anchor => anchor.hash === decision.sourceHash), 'Primary source must belong to the complete citation context.');
export const learnerDecisionV3Schema = z.union([singleSourceDecisionSchema, citationDecisionSchema]);
export const learnerIntentSchema = z.union([learnerDecisionV3Schema, legacyDecisionSchema.transform(decision => ({ ...decision, context: { kind: 'source' as const } }))]);
export const repositorySelectionSchema = z.strictObject({ bookId: bookIdSchema, revision: z.number().int().positive(), nodeId: bookIdSchema,
  anchorIndex: z.number().int().nonnegative().max(BOOK_MAX_ANCHORS - 1),
  // Optional visual anchor survives error-content reflow; legacy section/fraction positions remain readable.
  location: z.strictObject({ sectionIndex: z.number().int().nonnegative().max(BOOK_MAX_SECTIONS + REPOSITORY_FIXED_READING_SECTIONS - 1), fraction: z.number().min(0).max(1), focusId: z.string().max(KEY_LENGTH_LIMIT).regex(/^[a-z0-9-]*$/), focusViewportFraction: z.number().min(0).max(1).optional() }).optional() });
export const progressV3Schema = z.strictObject({ version: z.literal(LEARNING_SCHEMA_VERSION_V3), workspaceKey: repositoryHashSchema,
  decisions: z.array(learnerDecisionV3Schema).max(MAX_LEARNER_DECISIONS), selection: selectionSchema.optional(), repositorySelection: repositorySelectionSchema.optional() });
export const repositoryReturnSchema = z.strictObject({ studyId: studyIdSchema, selection: repositorySelectionSchema });
export const progressV4Schema = progressV3Schema.extend({ version: z.literal(LEARNING_SCHEMA_VERSION_V4), selection: retainedStudySelectionSchema.optional(), repositoryReturn: repositoryReturnSchema.optional() });
export type LearnerProgress = z.output<typeof progressV4Schema>;
export type LearnerDecision = z.input<typeof learnerIntentSchema>;
export type SavedLearnerDecision = LearnerProgress['decisions'][number];
export type RepositorySelection = z.infer<typeof repositorySelectionSchema>;
