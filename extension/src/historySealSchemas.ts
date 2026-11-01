import { z } from 'zod'

import { studyIdSchema } from './legacyStudySchemas'
import { repositoryHashSchema } from './sourceSchemas'

/** One reason a history is partial: a stable `code`, the `params` that make `text`, and the exact `text` the learner reads. */
export const historySealReasonSchema = z.strictObject({
  code: z.string().min(1).max(128),
  params: z.record(z.string(), z.union([z.string().max(1_024), z.number()])),
  text: z.string().min(1).max(2_048),
})

/**
 * Builds the seal schema of a profile whose seal names its reasons: its status, every reason uncut, the capture outcome and the journal's hash. A seal is complete exactly when it names no reason.
 * Used by the node-server and the chrome-extension profile; `interrupted` is never persisted.
 * @param version - The profile's literal seal `version`.
 * @param maxEntries - The most entries the profile's journal holds.
 * @returns The strict seal schema.
 * @example const sealSchema = buildStructuredHistorySealSchema(1, 10_000)
 */
export function buildStructuredHistorySealSchema<Version extends number>(
  version: Version,
  maxEntries: number,
) {
  return z
    .strictObject({
      version: z.literal(version),
      studyId: studyIdSchema,
      entryCount: z.number().int().nonnegative().max(maxEntries),
      journalBytes: z.number().int().nonnegative(),
      journalHash: repositoryHashSchema,
      status: z.enum(['complete', 'partial']),
      endedAt: z.iso.datetime(),
      reasons: z.array(historySealReasonSchema),
      capture: z.enum(['complete', 'incomplete']),
      /** The first reason's text cut to the index's bound, so a summary reads `reason` as for a test history. */
      reason: z.string().max(1_024).optional(),
    })
    .refine(
      (seal) =>
        (seal.status === 'complete') === (seal.reasons.length === 0) &&
        (seal.capture === 'complete') === (seal.reasons.length === 0),
      'A seal is complete exactly when it names no reason.',
    )
}
