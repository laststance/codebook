import { z } from 'zod';
import { MAX_EXPLANATION_CHARS, REFERENCE_LENGTH_LIMIT, LEARNING_SUMMARY_LIMITS } from './constants';

export const learningStepIdSchema = z.string().min(1).max(LEARNING_SUMMARY_LIMITS.identifierChars).regex(/^[a-zA-Z0-9_-]+$/);
const sourceReference = z.strictObject({ snapshotUri: z.string().min(1).max(REFERENCE_LENGTH_LIMIT), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) });
const terminalReference = z.strictObject({ kind: z.literal('terminal'), configurationHash: z.string().regex(/^[a-f0-9]{64}$/), captureHash: z.string().regex(/^[a-f0-9]{64}$/) });
const reference = z.union([sourceReference, terminalReference]);
export const learningSummarySchema = z.strictObject({
  question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
  title: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.titleChars),
  summary: z.string().min(1).max(MAX_EXPLANATION_CHARS),
  participants: z.array(z.strictObject({ id: learningStepIdSchema, label: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.participantLabelChars) })).min(1).max(LEARNING_SUMMARY_LIMITS.participants),
  steps: z.array(z.strictObject({ id: learningStepIdSchema, from: learningStepIdSchema, to: learningStepIdSchema,
    label: z.string().min(1).max(LEARNING_SUMMARY_LIMITS.stepLabelChars), explanation: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    evidence: z.enum(['observed', 'source-derived', 'unknown']), reference: reference.optional(),
  })).min(1).max(LEARNING_SUMMARY_LIMITS.steps),
}).refine(value => {
  const participants = new Set(value.participants.map(participant => participant.id));
  return participants.size === value.participants.length && new Set(value.steps.map(step => step.id)).size === value.steps.length
    && value.steps.every(step => participants.has(step.from) && participants.has(step.to) && (step.evidence === 'unknown' || step.reference));
}, 'Use unique participant/step IDs, declared participants and a verified reference for every observed or source-derived step.').refine(value => Buffer.byteLength(JSON.stringify(value), 'utf8') <= LEARNING_SUMMARY_LIMITS.bytes, 'Learning summary exceeds its total byte limit.');
export type LearningSummary = z.infer<typeof learningSummarySchema>;
export const savedLearningSummarySchema = z.strictObject({ content: learningSummarySchema, explanationId: z.uuid(), createdAt: z.iso.datetime() });
export type SavedLearningSummary = z.infer<typeof savedLearningSummarySchema>;
