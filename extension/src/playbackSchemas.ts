import { z } from 'zod';
import { studyIdSchema } from './legacyStudySchemas';
import { recordingHashSchema } from './recordingSchemas';
import { RECORDING_VERSION } from './constants';

const identity = { instanceId: z.uuid(), studyId: studyIdSchema, expectedRevision: z.number().int().nonnegative() };
export const playbackCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...identity, action: z.enum(['open', 'play', 'pause']) }),
  z.strictObject({ ...identity, action: z.literal('seek'), positionMs: z.number().finite().nonnegative() }),
]);
export type PlaybackCommand = z.infer<typeof playbackCommandSchema>;
export const playbackPreferenceSchema = z.strictObject({ version: z.literal(RECORDING_VERSION), workspaceKey: recordingHashSchema, studyId: studyIdSchema, contextHash: recordingHashSchema.optional(), positionMs: z.number().finite().nonnegative() });
export type PlaybackPreference = z.infer<typeof playbackPreferenceSchema>;
