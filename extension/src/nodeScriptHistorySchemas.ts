import { z } from 'zod'

import {
  MAX_EXPLANATION_CHARS,
  NODE_SCRIPT_END_KINDS,
  NODE_SCRIPT_END_LIMITS,
  NODE_SCRIPT_EXIT_UNKNOWN_LIMIT_CHARS,
  NODE_SCRIPT_HISTORY_FORMAT_VERSION,
  NODE_SCRIPT_PROFILE,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
  NODE_SERVER_HISTORY_MAX_STOPS,
  REPOSITORY_PATH_LIMIT_CHARS,
} from './constants'
import { buildStructuredHistorySealSchema } from './historySealSchemas'
import { studyIdSchema } from './legacyStudySchemas'
import {
  nodeRunDeclaredStopsSchema,
  nodeRunEntryBase,
  nodeRunOutputEntrySchema,
  nodeRunOutputTruncatedEntrySchema,
  nodeRunRepositoryRevisionSchema,
  nodeRunSourceEntrySchema,
  nodeRunSourceHashesSchema,
  nodeRunStopEntrySchema,
} from './nodeServerHistorySchemas'
import { repositoryHashSchema } from './sourceSchemas'

const repositoryPath = z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS)
const declaredStopIndexList = z
  .array(
    z
      .number()
      .int()
      .nonnegative()
      .max(NODE_SERVER_HISTORY_MAX_STOPS - 1),
  )
  .max(NODE_SERVER_HISTORY_MAX_STOPS)

/**
 * The header of a node-script history: the run's identity, its question, the script it ran (`packageRoot`, `entry`, `loader`), the declared stops, the repository revision and the hashes of the declared sources. It has no request.
 * @example nodeScriptHistoryHeaderSchema.parse({ formatVersion: 1, profile: 'node-script', … })
 */
export const nodeScriptHistoryHeaderSchema = z
  .strictObject({
    formatVersion: z.literal(NODE_SCRIPT_HISTORY_FORMAT_VERSION),
    profile: z.literal(NODE_SCRIPT_PROFILE),
    workspaceKey: repositoryHashSchema,
    studyId: studyIdSchema,
    instanceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    /** The package folder the script runs in, repository-relative (`.` for the repository root). */
    packageRoot: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
    /** The script's entry file, repository-relative. */
    entry: repositoryPath,
    /** How the entry is loaded (`node`, or `tsx` for TypeScript). */
    loader: z.string().min(1).max(32),
    declaredStops: nodeRunDeclaredStopsSchema,
    repositoryRevision: nodeRunRepositoryRevisionSchema,
    sourceHashes: nodeRunSourceHashesSchema,
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Node script history identity differs from its run.',
  )

/**
 * The one `end` entry of a script history: how the run ended and which declared stops it reached.
 * `stopsNeverReached` is always present; once the capture budget was spent, the stops not reached before that are `stopsNotObserved`, never never-reached, because their breakpoints were retired.
 */
const nodeScriptEndEntrySchema = z.strictObject({
  type: z.literal('end'),
  ...nodeRunEntryBase,
  kind: z.enum(NODE_SCRIPT_END_KINDS),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().max(32).nullable().optional(),
  /** Why the exit code could not be read, when it could not. */
  exitUnknown: z.string().max(NODE_SCRIPT_EXIT_UNKNOWN_LIMIT_CHARS).optional(),
  limit: z.enum(NODE_SCRIPT_END_LIMITS).optional(),
  stopsReached: declaredStopIndexList,
  stopsNeverReached: declaredStopIndexList,
  captureBudgetExhausted: z.literal(true).optional(),
  stopsNotObserved: declaredStopIndexList.optional(),
})

/** One entry of a node-script journal; each carries its journal `sequence` and `elapsedMs` since launch. */
export const nodeScriptHistoryEntrySchema = z.discriminatedUnion('type', [
  nodeRunOutputEntrySchema,
  nodeRunSourceEntrySchema,
  nodeRunStopEntrySchema,
  nodeRunOutputTruncatedEntrySchema,
  nodeScriptEndEntrySchema,
])

/** The seal of a node-script history: its status, every reason uncut, the capture outcome and the journal's hash. */
export const nodeScriptHistorySealSchema = buildStructuredHistorySealSchema(
  NODE_SCRIPT_HISTORY_FORMAT_VERSION,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
)

export type NodeScriptHistoryHeader = z.infer<
  typeof nodeScriptHistoryHeaderSchema
>
export type NodeScriptHistoryEntry = z.infer<
  typeof nodeScriptHistoryEntrySchema
>
export type NodeScriptHistorySeal = z.infer<typeof nodeScriptHistorySealSchema>
/** The `end` entry of a script journal. */
export type NodeScriptEndEntry = z.infer<typeof nodeScriptEndEntrySchema>
/** The end of a script run without its entry bookkeeping: what the run tells its history sink and the writer appends. */
export type NodeScriptEnd = Omit<
  NodeScriptEndEntry,
  'type' | 'sequence' | 'elapsedMs'
>
/** The `end` of a script run with its time, before its sequence is assigned, as the writer accepts it. */
export type NodeScriptEndInput = Omit<NodeScriptEndEntry, 'type' | 'sequence'>
/** A script journal entry before its sequence is assigned, as the writer accepts it. */
export type NodeScriptHistoryEntryInput =
  NodeScriptHistoryEntry extends infer Entry
    ? Entry extends NodeScriptHistoryEntry
      ? Omit<Entry, 'sequence'>
      : never
    : never
