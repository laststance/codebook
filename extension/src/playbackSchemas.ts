import { z } from 'zod'

import { PLAYBACK_SEEK_STOP_SNAP_MS, RECORDING_VERSION } from './constants'
import { studyIdSchema } from './legacyStudySchemas'
import { recordingHashSchema } from './recordingSchemas'

const identity = {
  instanceId: z.uuid(),
  studyId: studyIdSchema,
  expectedRevision: z.number().int().nonnegative(),
}
const positionMs = z.number().finite().nonnegative()
export const playbackCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...identity, action: z.enum(['open', 'play', 'pause']) }),
  z.strictObject({ ...identity, action: z.literal('seek'), positionMs }),
])
export type PlaybackCommand = z.infer<typeof playbackCommandSchema>
// SDK 1.x publishes only object schemas; retain {@link playbackCommandSchema}'s conditional validation at this discoverable boundary.
export const playbackToolSchema = z
  .strictObject({
    ...identity,
    action: z.enum(['open', 'play', 'pause', 'seek']),
    positionMs: positionMs
      .optional()
      .describe(
        `Required only for seek; use a position within the returned recording range. A position less than ${PLAYBACK_SEEK_STOP_SNAP_MS} ms before a recorded stop presents that stop. Omit for open, play and pause.`,
      ),
  })
  .superRefine((input, context) => {
    const parsed = playbackCommandSchema.safeParse(input)
    if (!parsed.success)
      for (const issue of parsed.error.issues) context.addIssue({ ...issue })
  })
export const playbackPreferenceSchema = z.strictObject({
  version: z.literal(RECORDING_VERSION),
  workspaceKey: recordingHashSchema,
  studyId: studyIdSchema,
  contextHash: recordingHashSchema.optional(),
  positionMs: z.number().finite().nonnegative(),
})
export type PlaybackPreference = z.infer<typeof playbackPreferenceSchema>
