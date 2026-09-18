import { z } from 'zod';
import type { StudyService } from './service';
import { continueSchema } from './schemas';
import { CAPTURE_PHASES, IMAGE_BASE64_LIMIT_CHARS, KEY_LENGTH_LIMIT, LEARNING_SCHEMA_VERSION, MAX_EXPLANATIONS, MAX_LEARNER_DECISIONS, MAX_STUDY_LINKS, MAX_STUDY_OBSERVATIONS, MAX_UI_TEXT_CHARS, PROFILE_ID, REFERENCE_LENGTH_LIMIT, SOURCE_LIMIT_BYTES, VALUE_PATHS } from './constants';

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
  pause: continueSchema.omit({ instanceId: true, runId: true, participant: true }), source: sourceSchema, values: valuesSchema,
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
export type StudyArchive = z.infer<typeof studyArchiveSchema>;
export type StudySelection = z.infer<typeof selectionSchema>;
export type LearnerProgress = z.infer<typeof progressSchema>;
export type LearnerDecision = z.infer<typeof learnerDecisionSchema>;
export type StudyParticipant = z.infer<typeof participantSchema>;
export type SourceBaseline = z.infer<typeof sourceSchema> & { path: string };
export type SourceBaselines = Record<StudyParticipant, SourceBaseline>;
export type LiveStudy = ReturnType<StudyService['state']>;

export const LEARNING_ITEMS = [
  { participant: participantSchema.enum.server, id: 'paired-cart-demo/server', title: 'Server cart mutation', file: 'server.mts', overview: 'The server admits the selected cart request and adds the product to its cart state. The stop is immediately before that mutation. These statements describe source structure; a captured observation supplies actual runtime values.' },
  { participant: participantSchema.enum.browser, id: 'paired-cart-demo/browser', title: 'Browser display update', file: 'client.mts', overview: 'The browser awaits the selected cart response and updates the displayed count. The stop is immediately before the DOM update. Request correspondence is observed only when the runtime has closed and checked the complete request set.' },
];

/** Separates current-source understanding from retained historical decisions for {@link projectStudy}. @example learningState(progress, 'server', hash).reviewNeeded */
export function learningState(progress: LearnerProgress | undefined, item: StudyParticipant, currentHash: string | undefined) {
  const latest = new Map<string, LearnerDecision>();
  // A later uncheck supersedes only that source revision, never another historical decision.
  for (const decision of progress?.decisions ?? []) if (decision.item === item) latest.set(decision.sourceHash, decision);
  const current = currentHash ? latest.get(currentHash) : undefined;
  return { known: Boolean(progress) && Boolean(currentHash), understood: current?.understood === true, at: current?.at,
    reviewNeeded: current?.understood !== true && [...latest.values()].some(decision => decision.sourceHash !== currentHash && decision.understood), history: [...latest.values()] };
}

/** Joins one selected observation without letting live control or old progress redefine its identity. @example projectStudy({selection, study, live, progress, baselines}).continueArguments */
export function projectStudy(input: { selection: StudySelection; study?: StudyArchive; live?: Pick<LiveStudy, 'instanceId' | 'runId' | 'participants'>; progress?: LearnerProgress; baselines: SourceBaselines; currentSourceAvailable?: boolean }) {
  const { selection, study, live, progress, baselines, currentSourceAvailable = true } = input;
  const observation = study && study.id === selection.studyId ? study.observations.find(value => value.participant === selection.participant) : undefined;
  const currentParticipant = LEARNING_ITEMS.find(item => live?.participants[item.participant].resumable)?.participant;
  const current = currentParticipant && live?.participants[currentParticipant];
  const matching = Boolean(observation && live && study?.runId === live.runId && study.instanceId === live.instanceId && current && observation.snapshotUri === current.snapshotUri && observation.participant === currentParticipant);
  const source = observation?.source ?? baselines[selection.participant];
  const progressByItem = LEARNING_ITEMS.map(item => ({ ...item, ...learningState(progress, item.participant, currentSourceAvailable ? baselines[item.participant].hash : undefined) }));
  return { selection, observation, source, currentSourceAvailable, currentParticipant, currentSnapshotUri: current ? current.snapshotUri : undefined, matching,
    continueArguments: matching && current ? current.continueArguments : undefined,
    image: observation ? study?.captures.find(capture => capture.phase === `paused-${observation.participant}`) : undefined,
    sourceChanged: currentSourceAvailable && source.hash !== baselines[selection.participant].hash,
    selectedUnderstanding: learningState(progress, selection.participant, observation || currentSourceAvailable ? source.hash : undefined), progressByItem,
    understoodCount: progressByItem.filter(item => item.understood).length, reviewCount: progressByItem.filter(item => item.reviewNeeded).length };
}
