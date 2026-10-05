import { z } from 'zod'

import { IMAGE_BASE64_LIMIT_CHARS, MAX_UI_TEXT_CHARS } from './constants'
import { repositoryItemSchema } from './identitySchemas'
import { studyIdSchema } from './legacyStudySchemas'

export const profileSchema = z.literal('repository-browser')
export const itemSchema = repositoryItemSchema
export const capturePhaseSchema = z.enum([
  'before',
  'paused-browser',
  'paused-server',
  'after',
])
export const capturedImageSchema = z.discriminatedUnion('status', [
  z.strictObject({
    phase: capturePhaseSchema,
    status: z.literal('captured'),
    base64: z.string().max(IMAGE_BASE64_LIMIT_CHARS),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    phase: capturePhaseSchema,
    status: z.enum(['pending', 'failed', 'absent']),
    reason: z.string().max(MAX_UI_TEXT_CHARS),
  }),
])
export const selectionSchema = z.strictObject({
  studyId: studyIdSchema.optional(),
  profile: profileSchema,
  itemId: repositoryItemSchema,
  follow: z.boolean(),
  tab: z.enum(['overview', 'live']),
})
export const learnerDecisionSchema = z.strictObject({
  id: z.uuid(),
  item: repositoryItemSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  understood: z.boolean(),
  at: z.iso.datetime(),
})
export interface StudyCatalogEntry {
  id: string
  savedAt: string
  profile?: 'repository-browser' | 'node-test'
  /**
   * `newer` marks a study a newer Codebook saved in a format this one cannot read: it is listed and counted, never opened, repaired or deleted here, and its `reason` is the sentence that says so.
   * `archive-missing` marks what is left of a study whose archive is gone (a catalog sidecar, a recording), as after its files were removed by hand in part: it is listed so that the rest can be removed, never opened or repaired, and it has no `reason`.
   */
  format:
    | 'legacy-v1'
    | 'v2'
    | 'v3'
    | 'v4'
    | 'node-test-history'
    | 'newer'
    | 'archive-missing'
  outcome: string
  metadata: 'legacy-unverified' | 'validated' | 'unavailable'
  reason?: string
}
