import { z } from 'zod'

import {
  CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
  CHROME_EXTENSION_PROFILE,
  EXTENSION_HISTORY_FORMAT_NEWER_TEXT,
  EXTENSION_HISTORY_KNOWN_CONTEXTS,
  EXTENSION_HISTORY_MAX_ENTRIES,
  EXTENSION_HISTORY_REASON_CODES,
  EXTENSION_HISTORY_TEXT_LIMIT_CHARS,
  EXTENSION_STOP_LIMIT,
  MAX_EXPLANATION_CHARS,
  REPOSITORY_PATH_LIMIT_CHARS,
} from './constants'
import type { historySealReasonSchema } from './historySealSchemas'
import { buildStructuredHistorySealSchema } from './historySealSchemas'
import { studyIdSchema } from './legacyStudySchemas'
import { replayDebugSnapshotSchema } from './replayDebugSchemas'
import { repositoryHashSchema } from './sourceSchemas'

const base = {
  sequence: z.number().int().positive().max(EXTENSION_HISTORY_MAX_ENTRIES),
  /** The host's monotonic run clock when the writer accepted the entry; never a Chrome timestamp. */
  elapsedMs: z.number().finite().nonnegative(),
}
const text = z.string().min(1).max(EXTENSION_HISTORY_TEXT_LIMIT_CHARS)
const repositoryPath = z.string().min(1).max(REPOSITORY_PATH_LIMIT_CHARS)
/** An open string set: this build reads `page` and `service-worker`; {@link assertKnownExtensionContext} refuses any other on read so a later context needs no format bump. */
const context = z.string().min(1).max(64)
const pauseId = z.string().min(1).max(256)
const stopIndex = z.number().int().min(1).max(EXTENSION_STOP_LIMIT)

/**
 * The header of a chrome-extension history: the run's identity, its question, the extension (name and version from its manifest), the surface it opened, the declared stops, the repository revision and the Chrome that ran it.
 * @example extensionHistoryHeaderSchema.parse({ formatVersion: 1, profile: 'chrome-extension', … })
 */
const extensionHistoryHeaderSchema = z
  .strictObject({
    formatVersion: z.literal(CHROME_EXTENSION_HISTORY_FORMAT_VERSION),
    profile: z.literal(CHROME_EXTENSION_PROFILE),
    workspaceKey: repositoryHashSchema,
    studyId: studyIdSchema,
    instanceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    question: z.string().min(1).max(MAX_EXPLANATION_CHARS),
    extension: z.strictObject({
      id: z.string().min(1).max(64),
      name: z.string().min(1).max(256),
      version: z.string().min(1).max(64),
    }),
    surface: z.strictObject({
      kind: z.enum(['popup', 'page']),
      path: repositoryPath,
    }),
    declaredStops: z
      .array(
        z.strictObject({
          index: stopIndex,
          path: repositoryPath,
          line: z.number().int().positive(),
          context,
        }),
      )
      .min(1)
      .max(EXTENSION_STOP_LIMIT),
    repositoryRevision: z.strictObject({
      revision: z.string().min(1).max(1_024),
      dirty: z.boolean(),
    }),
    chrome: z.strictObject({ version: z.string().min(1).max(128) }),
  })
  .refine(
    (value) => value.studyId === `${value.instanceId}_${value.runId}`,
    'Chrome extension history identity differs from its run.',
  )

/** Why a pause ended: the learner or chat continued it, its worker went away, the surface closed or the run ended. */
const EXTENSION_PAUSE_CLOSE_REASONS = [
  'continue',
  'worker-lost',
  'surface-lost',
  'run-ended',
] as const

/** One entry of a chrome-extension journal; each carries its journal `sequence` and `elapsedMs` on the run clock. */
const extensionHistoryEntrySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('pause-open'),
    ...base,
    pauseId,
    /** The debugger's pause generation. */
    generation: z.number().int().nonnegative(),
    context,
    stopIndex,
    /** A page stop's URL is the surface URL; a worker stop's is derived from the manifest's worker path. */
    targetUrl: text,
    /** Incremented for each new worker child session; 0 for page stops. */
    workerGeneration: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('capture'),
    ...base,
    pauseId,
    path: repositoryPath,
    line: z.number().int().positive(),
    sourceHash: repositoryHashSchema,
    /** The byte length of the executed file the snapshot's top frame carries. */
    sourceBytes: z.number().int().nonnegative(),
    debuggerSnapshot: replayDebugSnapshotSchema,
    facts: z.record(z.string(), z.json()),
  }),
  z.strictObject({
    type: z.literal('pause-close'),
    ...base,
    pauseId,
    reason: z.enum(EXTENSION_PAUSE_CLOSE_REASONS),
    /** When the pause left the debugger's open set, on the run clock, for a close journaled later (a Continue pressed in the editor's toolbar is learned at the next pause-set change). At most `elapsedMs` and not before the pause opened; the replay ends the stop here. Absent: the stop ended when the entry was appended. */
    endedAtMs: z.number().finite().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('frame'),
    ...base,
    /** `stream` is a sampled screencast frame; `pin` is the screenshot taken at a pause (it names that pause). */
    kind: z.enum(['stream', 'pin']),
    pauseId: pauseId.optional(),
    /** The SHA-256 of the PNG; the blob is `frames/<hash>.png` in the history's folder. */
    hash: repositoryHashSchema,
    byteLength: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** When the frame was received, on the run clock; at most `elapsedMs`, because the entry is appended after its blob is durable. This is the frame's place on the timeline. */
    capturedAtMs: z.number().finite().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('result'),
    ...base,
    outcome: z.enum(['changed', 'unchanged', 'missing', 'unavailable']),
    /** The observation before the first click and after the last, masked as the run resource reports them. */
    before: z.json().optional(),
    after: z.json().optional(),
    cause: z.string().max(EXTENSION_HISTORY_TEXT_LIMIT_CHARS).optional(),
  }),
])

/** The seal of a chrome-extension history: status, every reason uncut and the journal's hash. `interrupted` is never persisted: it is read when a history has no seal and no live writer. */
export const extensionHistorySealSchema = buildStructuredHistorySealSchema(
  CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
  EXTENSION_HISTORY_MAX_ENTRIES,
)

export type ExtensionHistoryHeader = z.infer<
  typeof extensionHistoryHeaderSchema
>
export type ExtensionHistoryEntry = z.infer<typeof extensionHistoryEntrySchema>
export type ExtensionHistorySeal = z.infer<typeof extensionHistorySealSchema>
export type ExtensionHistorySealReason = z.infer<typeof historySealReasonSchema>
/** One entry of the given `type`. */
export type ExtensionHistoryEntryOf<
  Type extends ExtensionHistoryEntry['type'],
> = Extract<ExtensionHistoryEntry, { type: Type }>
/** Why a pause closed. */
export type ExtensionPauseCloseReason =
  (typeof EXTENSION_PAUSE_CLOSE_REASONS)[number]
/** An entry before its sequence and run-clock time are assigned, as the writer's typed methods build it. */
export type ExtensionHistoryEntryInput =
  ExtensionHistoryEntry extends infer Entry
    ? Entry extends ExtensionHistoryEntry
      ? Omit<Entry, 'sequence' | 'elapsedMs'>
      : never
    : never

/**
 * Refuses a context this build does not read, with the format-newer code, so a history a later Codebook recorded (for example with a content script) lists as unavailable instead of replaying wrongly.
 * Called by {@link parseExtensionHistoryHeader} and {@link parseExtensionHistoryEntry} before the schema runs.
 * @param value - The context text of a header's declared stop or a pause-open entry.
 * @throws An error that starts with `EXTENSION_HISTORY_FORMAT_NEWER` for any context other than `page` and `service-worker`.
 * @example assertKnownExtensionContext('content-script') // throws 'EXTENSION_HISTORY_FORMAT_NEWER: Recorded by a newer Codebook; …'
 */
function assertKnownExtensionContext(value: unknown): void {
  if (
    typeof value === 'string' &&
    !EXTENSION_HISTORY_KNOWN_CONTEXTS.includes(value)
  )
    throw new Error(
      `${EXTENSION_HISTORY_REASON_CODES.formatNewer}: ${EXTENSION_HISTORY_FORMAT_NEWER_TEXT}`,
    )
}

/**
 * Parses a stored header; the one reader behind the descriptor, so a header with an unknown declared context is refused (and never listed or deleted).
 * @param value - The parsed JSON of a header file.
 * @returns The header.
 * @throws The format-newer error for an unknown context; the schema's error otherwise.
 * @example parseExtensionHistoryHeader(JSON.parse(text)).extension.name // => 'Notes'
 */
export function parseExtensionHistoryHeader(
  value: unknown,
): ExtensionHistoryHeader {
  if (typeof value === 'object' && value !== null) {
    const stops: unknown = Reflect.get(value, 'declaredStops')
    if (Array.isArray(stops))
      for (const stop of stops)
        if (typeof stop === 'object' && stop !== null)
          assertKnownExtensionContext(Reflect.get(stop, 'context'))
  }
  return extensionHistoryHeaderSchema.parse(value)
}

/**
 * Parses one stored journal entry; the one reader behind the writer, the scan and the full read.
 * @param value - The parsed JSON of a journal line.
 * @returns The entry.
 * @throws The format-newer error for a `pause-open` of an unknown context; the schema's error otherwise.
 * @example parseExtensionHistoryEntry({ type: 'pause-close', sequence: 3, elapsedMs: 40, pauseId: 'p', reason: 'continue' }).type // => 'pause-close'
 */
export function parseExtensionHistoryEntry(
  value: unknown,
): ExtensionHistoryEntry {
  if (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'type') === 'pause-open'
  )
    assertKnownExtensionContext(Reflect.get(value, 'context'))
  return extensionHistoryEntrySchema.parse(value)
}
