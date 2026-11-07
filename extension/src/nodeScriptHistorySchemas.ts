import { z } from 'zod'

import {
  MAX_EXPLANATION_CHARS,
  NODE_SCRIPT_END_KINDS,
  NODE_SCRIPT_END_LIMITS,
  NODE_SCRIPT_EXIT_UNKNOWN_LIMIT_CHARS,
  NODE_SCRIPT_HISTORY_FORMAT_VERSION,
  NODE_SCRIPT_HISTORY_LIBRARY_FORMAT_VERSION,
  NODE_SCRIPT_HISTORY_SEAL_VERSION,
  NODE_SCRIPT_LIBRARY_OBSERVATIONS,
  NODE_SCRIPT_LIBRARY_PACKAGE_MANAGERS,
  NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_PATH_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_REVISION_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS,
  NODE_SCRIPT_LOADERS,
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

/** The fields every header format carries; `formatVersion` and the format 2 `library` identity are added per format. */
const nodeScriptHistoryHeaderShape = {
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
  /** How the entry is loaded: `node`, or `tsx` for TypeScript, as the configuration's loader. */
  loader: z.enum(NODE_SCRIPT_LOADERS),
  declaredStops: nodeRunDeclaredStopsSchema,
  repositoryRevision: nodeRunRepositoryRevisionSchema,
  sourceHashes: nodeRunSourceHashesSchema,
}

/** The library a format 2 header declares: its package name and folder only. What the build made and what the script loaded are journal events, because the header is written before the build. */
const nodeScriptHistoryLibrarySchema = z.strictObject({
  package: z.string().min(1).max(NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS),
  packageRoot: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
})

/**
 * The header of a node-script history: the run's identity, its question, the script it ran (`packageRoot`, `entry`, `loader`), the declared stops, the repository revision and the hashes of the declared sources. It has no request.
 * Format 1 (a run without `library`) has no `library`; format 2 (a run with `library`) requires the declared identity. A header above 2 fails, so an older reader of a newer history neither lists nor deletes it.
 * @example nodeScriptHistoryHeaderSchema.parse({ formatVersion: 1, profile: 'node-script', … })
 */
export const nodeScriptHistoryHeaderSchema = z
  .discriminatedUnion('formatVersion', [
    z.strictObject({
      formatVersion: z.literal(NODE_SCRIPT_HISTORY_FORMAT_VERSION),
      ...nodeScriptHistoryHeaderShape,
    }),
    z.strictObject({
      formatVersion: z.literal(NODE_SCRIPT_HISTORY_LIBRARY_FORMAT_VERSION),
      ...nodeScriptHistoryHeaderShape,
      library: nodeScriptHistoryLibrarySchema,
    }),
  ])
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Node script history identity differs from its run.',
  )

/**
 * The `library.prepared` entry: what the build and pack of the declared library made, written once after the pack and before the script's own entries. Only a format 2 history holds it.
 * `installedVersion` is the version the Example's own `node_modules` held, `null` when it held none; it is disclosure only.
 */
const nodeScriptLibraryPreparedEntrySchema = z.strictObject({
  type: z.literal('library.prepared'),
  ...nodeRunEntryBase,
  package: z.string().min(1).max(NODE_SCRIPT_LIBRARY_PACKAGE_LIMIT_CHARS),
  version: z.string().min(1).max(NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS),
  packageRoot: z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS),
  revision: z.string().min(1).max(NODE_SCRIPT_LIBRARY_REVISION_LIMIT_CHARS),
  dirty: z.boolean(),
  packageManager: z.enum(NODE_SCRIPT_LIBRARY_PACKAGE_MANAGERS),
  buildMs: z.number().finite().nonnegative(),
  packMs: z.number().finite().nonnegative(),
  tarballSha256: repositoryHashSchema,
  installedVersion: z
    .string()
    .min(1)
    .max(NODE_SCRIPT_LIBRARY_VERSION_LIMIT_CHARS)
    .nullable(),
})

/**
 * The `library.observed` entry: what the script loaded, read after its process tree ended and written before `end`. Only a format 2 history holds it, once, after `library.prepared`.
 * `observation` says how far the observation file can be trusted: `incomplete` (no closing line) and `unreadable` are never read as "not loaded".
 */
const nodeScriptLibraryObservedEntrySchema = z.strictObject({
  type: z.literal('library.observed'),
  ...nodeRunEntryBase,
  loaded: z.boolean(),
  loadCount: z.number().int().nonnegative(),
  otherCopyLoaded: z.boolean(),
  otherCopyPath: z
    .string()
    .min(1)
    .max(NODE_SCRIPT_LIBRARY_PATH_LIMIT_CHARS)
    .optional(),
  observation: z.enum(NODE_SCRIPT_LIBRARY_OBSERVATIONS),
  cleanup: z.enum(['removed', 'pending']).optional(),
})

/**
 * The one `end` entry of a script history: how the run ended and which declared stops it reached.
 * `stopsNeverReached` is always present; once the capture budget was spent, the stops not reached before that are `stopsNotObserved`, never never-reached, because their breakpoints were retired.
 */
const nodeScriptEndShape = z.strictObject({
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
  /** Why the group was not signalled after the script's own exit (E10): its id was gone, belonged to another process, or could not be confirmed. */
  groupNotSignalled: z.enum(['gone', 'replaced', 'unverifiable']).optional(),
})

/** An `end` entry as its fields read before the kind's own rule is checked. */
type NodeScriptEndShape = z.infer<typeof nodeScriptEndShape>

/** For each end kind, the sentence that refuses an `end` missing what that kind needs, or `undefined` when the `end` tells its story. */
const NODE_SCRIPT_END_KIND_RULES: Record<
  NodeScriptEndShape['kind'],
  (end: NodeScriptEndShape) => string | undefined
> = {
  exited: (end) =>
    typeof end.exitCode === 'number' || end.exitUnknown !== undefined
      ? undefined
      : 'An exited end needs a numeric exitCode or exitUnknown.',
  signal: (end) => (end.signal ? undefined : 'A signal end needs its signal.'),
  limit: (end) =>
    end.limit === undefined ? 'A limit end needs its limit.' : undefined,
  stopped: (end) =>
    end.limit !== undefined || end.signal
      ? 'A stopped end takes neither a limit nor a signal.'
      : undefined,
}

// The kind decides which fields tell the story: an `end` that names its kind but not its cause could mislead every reader.
const nodeScriptEndEntrySchema = nodeScriptEndShape.superRefine(
  (end, context) => {
    const problem = NODE_SCRIPT_END_KIND_RULES[end.kind](end)
    if (problem) context.addIssue({ code: 'custom', message: problem })
  },
)

/** One entry of a node-script journal; each carries its journal `sequence` and `elapsedMs` since launch. */
export const nodeScriptHistoryEntrySchema = z.discriminatedUnion('type', [
  nodeRunOutputEntrySchema,
  nodeRunSourceEntrySchema,
  nodeRunStopEntrySchema,
  nodeRunOutputTruncatedEntrySchema,
  nodeScriptLibraryPreparedEntrySchema,
  nodeScriptLibraryObservedEntrySchema,
  nodeScriptEndEntrySchema,
])

/** The seal of a node-script history: its status, every reason uncut, the capture outcome and the journal's hash. */
export const nodeScriptHistorySealSchema = buildStructuredHistorySealSchema(
  NODE_SCRIPT_HISTORY_SEAL_VERSION,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
)

export type NodeScriptHistoryHeader = z.infer<
  typeof nodeScriptHistoryHeaderSchema
>
export type NodeScriptHistoryEntry = z.infer<
  typeof nodeScriptHistoryEntrySchema
>
/** The library identity a format 2 header declares. */
export type NodeScriptHistoryLibrary = z.infer<
  typeof nodeScriptHistoryLibrarySchema
>
/** A header before the store stamps its `formatVersion`: with `library` the store writes format 2, without it format 1. */
export type NodeScriptHistoryHeaderDraft = Omit<
  Extract<NodeScriptHistoryHeader, { formatVersion: 1 }>,
  'formatVersion'
> & { library?: NodeScriptHistoryLibrary }
/** The `library.prepared` entry of a format 2 script journal. */
export type NodeScriptLibraryPreparedEntry = z.infer<
  typeof nodeScriptLibraryPreparedEntrySchema
>
/** The `library.observed` entry of a format 2 script journal. */
export type NodeScriptLibraryObservedEntry = z.infer<
  typeof nodeScriptLibraryObservedEntrySchema
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
