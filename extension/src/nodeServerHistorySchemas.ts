import { z } from 'zod'

import {
  MAX_EXPLANATION_CHARS,
  NODE_SERVER_HISTORY_FORMAT_VERSION,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
  NODE_SERVER_HISTORY_MAX_STOPS,
  NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS,
  NODE_SERVER_PROFILE,
  NODE_SERVER_RESPONSE_BODY_LIMIT_CHARS,
  NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES,
  NODE_SERVER_STOP_UNAVAILABLE_LIMIT,
  REPOSITORY_PATH_LIMIT_CHARS,
} from './constants'
import { studyIdSchema } from './legacyStudySchemas'
import { nodeServerConfigSchema } from './nodeServerConfigSchemas'
import { replayDebugSnapshotSchema } from './replayDebugSchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import { repositoryHashSchema } from './sourceSchemas'

const base = {
  sequence: z.number().int().positive().max(NODE_SERVER_HISTORY_MAX_ENTRIES),
  elapsedMs: z.number().finite().nonnegative(),
}
const attempt = z.number().int().positive()
const repositoryPath = z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS)

/**
 * The header of a node-server history: the run's identity, its question, the declaration it ran (secret-named values masked; {@link maskNodeServerConfiguration}), the declared request and stops, the repository revision and the hashes of the declared sources.
 * `configurationHash` is the SHA-256 of the original declaration: identity only, never reversible.
 * @example nodeServerHistoryHeaderSchema.parse({ formatVersion: 1, profile: 'node-server', … })
 */
export const nodeServerHistoryHeaderSchema = z
  .strictObject({
    formatVersion: z.literal(NODE_SERVER_HISTORY_FORMAT_VERSION),
    profile: z.literal(NODE_SERVER_PROFILE),
    workspaceKey: repositoryHashSchema,
    studyId: studyIdSchema,
    instanceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    configurationHash: repositoryHashSchema,
    configuration: nodeServerConfigSchema,
    declaredRequest: z.strictObject({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().min(1).max(2_048),
    }),
    declaredStops: z
      .array(
        z.strictObject({
          path: repositoryPath,
          line: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(NODE_SERVER_HISTORY_MAX_STOPS),
    repositoryRevision: z.strictObject({
      revision: z.string().min(1).max(1_024),
      dirty: z.boolean(),
    }),
    sourceHashes: z
      .array(
        z.strictObject({ path: repositoryPath, hash: repositoryHashSchema }),
      )
      .max(NODE_SERVER_HISTORY_MAX_STOPS),
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Node server history identity differs from its run.',
  )

const stopSource = z.strictObject({
  path: repositoryPath,
  hash: repositoryHashSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
})

/** One entry of a node-server journal; each carries its journal `sequence` and `elapsedMs` since launch. */
export const nodeServerHistoryEntrySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('output'),
    ...base,
    channel: z.enum(['stdout', 'stderr']),
    text: z.string().min(1).max(NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS),
  }),
  z.strictObject({
    type: z.literal('request'),
    ...base,
    attempt,
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1).max(2_048),
    bodyBytes: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('request-withdrawn'),
    ...base,
    attempt,
    code: z.string().min(1).max(128),
  }),
  z.strictObject({ type: z.literal('request-sent'), ...base, attempt }),
  z
    .strictObject({
      type: z.literal('source'),
      ...base,
      path: repositoryPath,
      hash: repositoryHashSchema,
      text: z.string().max(NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES).optional(),
      sourceUnavailable: z.enum(['too large', 'not captured']).optional(),
    })
    .refine(
      (entry) =>
        entry.text === undefined
          ? entry.sourceUnavailable !== undefined
          : entry.sourceUnavailable === undefined &&
            sha256(entry.text) === entry.hash,
      'A source entry holds hash-verified text, or its hash with the reason its text is unavailable.',
    ),
  z.strictObject({
    type: z.literal('stop'),
    ...base,
    declaredStopIndex: z
      .number()
      .int()
      .nonnegative()
      .max(NODE_SERVER_HISTORY_MAX_STOPS - 1),
    hit: z.number().int().positive(),
    generation: z.number().int().nonnegative(),
    source: stopSource,
    frame: z.strictObject({ name: z.string().max(2_048) }),
    facts: z.record(z.string(), z.json()),
    // One entry per inspection the declaration allows; every one becomes an uncut seal reason.
    unavailable: z
      .array(
        z.strictObject({
          path: z.string().max(512),
          reason: z.string().max(1_024),
        }),
      )
      .max(NODE_SERVER_STOP_UNAVAILABLE_LIMIT),
    debuggerSnapshot: replayDebugSnapshotSchema,
  }),
  z.strictObject({
    type: z.literal('response'),
    ...base,
    status: z.number().int().min(100).max(599),
    contentType: z.string().max(256).nullable(),
    body: z.string().max(NODE_SERVER_RESPONSE_BODY_LIMIT_CHARS),
    bodyBytes: z.number().int().nonnegative(),
    readCut: z.boolean(),
    location: z.string().max(2_048).nullable(),
    requestDurationMs: z.number().finite().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('request-failed'),
    ...base,
    code: z.string().min(1).max(128),
    message: z.string().max(2_048),
  }),
  z.strictObject({
    type: z.literal('output-truncated'),
    ...base,
    limit: z.enum(['entries', 'bytes', 'queue']),
  }),
  z.strictObject({
    type: z.literal('end'),
    ...base,
    reason: z.enum(['stopped', 'closed', 'failed']),
    code: z.string().max(128).optional(),
    exitCode: z.number().int().nullable().optional(),
    signal: z.string().max(32).nullable().optional(),
  }),
])

/** One reason a server history is partial: a stable `code`, the `params` that make `text`, and the exact `text` the learner reads. */
const nodeServerSealReasonSchema = z.strictObject({
  code: z.string().min(1).max(128),
  params: z.record(z.string(), z.union([z.string().max(1_024), z.number()])),
  text: z.string().min(1).max(2_048),
})

/** The seal of a node-server history: its status, every reason uncut, the capture outcome and the journal's hash. */
export const nodeServerHistorySealSchema = z
  .strictObject({
    version: z.literal(NODE_SERVER_HISTORY_FORMAT_VERSION),
    studyId: studyIdSchema,
    entryCount: z
      .number()
      .int()
      .nonnegative()
      .max(NODE_SERVER_HISTORY_MAX_ENTRIES),
    journalBytes: z.number().int().nonnegative(),
    journalHash: repositoryHashSchema,
    status: z.enum(['complete', 'partial']),
    endedAt: z.iso.datetime(),
    reasons: z.array(nodeServerSealReasonSchema),
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

export type NodeServerHistoryHeader = z.infer<
  typeof nodeServerHistoryHeaderSchema
>
export type NodeServerHistoryEntry = z.infer<
  typeof nodeServerHistoryEntrySchema
>
export type NodeServerHistorySeal = z.infer<typeof nodeServerHistorySealSchema>
export type NodeServerSealReason = z.infer<typeof nodeServerSealReasonSchema>
/** One `stop` entry of a node-server journal. */
export type NodeServerStopEntry = Extract<
  NodeServerHistoryEntry,
  { type: 'stop' }
>
/** One `source` entry of a node-server journal. */
export type NodeServerSourceEntry = Extract<
  NodeServerHistoryEntry,
  { type: 'source' }
>
/** A journal entry before its sequence is assigned, as the writer accepts it. */
export type NodeServerHistoryEntryInput =
  NodeServerHistoryEntry extends infer Entry
    ? Entry extends NodeServerHistoryEntry
      ? Omit<Entry, 'sequence'>
      : never
    : never
