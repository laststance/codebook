import { z } from 'zod';
import { KEY_LENGTH_LIMIT, MAX_EXPLANATION_CHARS, MAX_VALUE_PATHS, VALUE_PATHS, REFERENCE_LENGTH_LIMIT } from './constants';

const instanceShape = { instanceId: z.uuid() };
const runShape = { ...instanceShape, runId: z.uuid() };
const key = z.string().min(1).max(KEY_LENGTH_LIMIT);
export const startSchema = z.strictObject({ ...instanceShape, profile: z.string().min(1).max(KEY_LENGTH_LIMIT), key });
export const runSchema = z.strictObject(runShape);
export const actionSchema = z.strictObject({ ...runShape, key, action: z.literal('add-to-cart') });
export const continueSchema = z.strictObject({ ...runShape, participant: z.enum(['server', 'browser']), sessionId: z.string().min(1).max(KEY_LENGTH_LIMIT), threadId: z.number().int().nonnegative(), generation: z.number().int().positive() });
export const revealSchema = z.strictObject({ ...runShape, snapshotUri: z.string().max(REFERENCE_LENGTH_LIMIT) });
export const explainSchema = z.strictObject({ ...runShape, key, snapshotUri: z.string().max(REFERENCE_LENGTH_LIMIT), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), valuePaths: z.array(z.enum(VALUE_PATHS)).min(1).max(MAX_VALUE_PATHS), interpretation: z.string().min(1).max(MAX_EXPLANATION_CHARS) });
export type StartInput = z.infer<typeof startSchema>;
export type ActionInput = z.infer<typeof actionSchema>;
export type ContinueInput = z.infer<typeof continueSchema>;
export type RunInput = z.infer<typeof runSchema>;
export type RevealInput = z.infer<typeof revealSchema>;
export type ExplainInput = z.infer<typeof explainSchema>;
