import { z } from 'zod';
import { itemSchema } from './studySchemas';

// Private native QA commands are deliberately finite; no arbitrary editor command or JavaScript bridge.
export const nativeStudyCommandSchema = z.strictObject({ sequence: z.number().int().nonnegative(), itemId: itemSchema.optional(), action: z.enum(['inspect', 'open-paused', 'select-history', 'assert-history', 'return-current', 'continue-current', 'move-source', 'assert-current', 'assert-recording', 'close-recording-pane', 'open-recording-pane', 'close-reader', 'finish']) });
export const nativeStudyResultSchema = z.object({ sequence: z.number(), descriptorPath: z.string().optional(), error: z.string().optional(), checks: z.record(z.string(), z.unknown()) });
export type NativeStudyAction = z.infer<typeof nativeStudyCommandSchema>['action'];
