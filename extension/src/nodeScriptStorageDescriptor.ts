import {
  NODE_SCRIPT_HISTORY_DIRECTORY,
  NODE_SCRIPT_HISTORY_FORMAT_VERSION,
  NODE_SCRIPT_HISTORY_LIBRARY_FORMAT_VERSION,
  NODE_SERVER_HISTORY_LIMIT_BYTES,
  NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES,
} from './constants'
import type { HistoryStorageDescriptor } from './historyStorageDescriptor'
import {
  buildNodeRunLearningCodec,
  citableRunEvidenceEvent,
  citedSequencesOf,
  summarizeRunEvidence,
  verifyRunSeal,
} from './nodeRunStorageParts'
import {
  nodeScriptHistoryEntrySchema,
  nodeScriptHistoryHeaderSchema,
  nodeScriptHistorySealSchema,
  type NodeScriptHistoryEntry,
  type NodeScriptHistoryHeader,
} from './nodeScriptHistorySchemas'
import type {
  NodeScriptHistorySummary,
  NodeScriptHistoryTypes,
} from './nodeScriptHistoryTypes'
import { NodeScriptHistoryWriter } from './nodeScriptHistoryWriter'
import {
  nodeScriptLearningMaterialContentSchema,
  nodeScriptLearningMaterialSchema,
} from './nodeScriptLearningSchemas'
import { evaluateNodeScriptCapture } from './utils/evaluateNodeScriptCapture'
import { evaluateNodeScriptLearning } from './utils/evaluateNodeScriptLearning'
import {
  acceptNodeScriptEntry,
  newNodeServerJournalProgress,
} from './utils/nodeServerJournalRules'
import type { CitableEvent } from './utils/recordingJournalScan'

/**
 * Reduces a script entry to what a learning step may cite: a stop (by its source hash), an output (by its channel) or the end; the storage-only entries (`source`, `output-truncated`) are never citable.
 * @param entry - A journal entry.
 * @returns The citable form, or `undefined` for an entry no step may cite.
 * @example citableScriptEvent(outputEntry) // => { type: 'output', channel: 'stdout' }
 */
function citableScriptEvent(
  entry: NodeScriptHistoryEntry,
): CitableEvent | undefined {
  switch (entry.type) {
    case 'stop':
    case 'output':
      return citableRunEvidenceEvent(entry)
    case 'end':
      return { type: 'end' }
    default:
      return undefined
  }
}

/**
 * Starts a script history's summary from its header, with nothing counted yet; the store fills in what the verified journal says, and an unavailable history keeps these values.
 * @param header - The history's header.
 * @returns A summary with the header's identity, question and entry, and no evidence.
 * @example emptyNodeScriptSummary(header).entry // => 'scripts/seed.mjs'
 */
function emptyNodeScriptSummary(
  header: NodeScriptHistoryHeader,
): NodeScriptHistorySummary {
  return {
    studyId: header.studyId,
    createdAt: header.createdAt,
    profile: 'node-script',
    status: 'partial',
    verification: 'unavailable',
    question: header.question,
    entry: header.entry,
    declaredStopCount: header.declaredStops.length,
    reachedStopCount: 0,
    stopCount: 0,
    captureComplete: false,
    captureMissing: [],
    captureMissingCount: 0,
    learningCoverage: 'none',
    learningMissing: [],
    learningMissingCount: 0,
    materialRevision: 0,
  }
}

/**
 * The node-script profile's storage descriptor: `node-scripts.v1/`, the script header and entries, the structured seal and the shared journal rules. Give it to a {@link NodeHistoryStore} to read, write, list and delete Script replays.
 * @example new NodeHistoryStore(nodeScriptStorageDescriptor, learningDirectory, workspaceKey, capacity, savedStudyCount)
 */
export const nodeScriptStorageDescriptor: HistoryStorageDescriptor<NodeScriptHistoryTypes> =
  {
    profile: 'node-script',
    directoryName: NODE_SCRIPT_HISTORY_DIRECTORY,
    journalLimitBytes: NODE_SERVER_HISTORY_LIMIT_BYTES,
    sealLimitBytes: NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES,
    words: {
      interruptedPrefix:
        'Interrupted Node script history after its verified prefix:',
      noSeal: 'Node script history has no verified final seal.',
      subject: 'Node script history',
    },
    learningMaterial: buildNodeRunLearningCodec<NodeScriptHistoryTypes>(
      nodeScriptLearningMaterialSchema,
      nodeScriptLearningMaterialContentSchema,
    ),
    // A header that declares its library is a `library` run's (format 2); every other run keeps format 1, which older versions read.
    stampHeader: (input) => ({
      ...input,
      formatVersion:
        'library' in input && input.library !== undefined
          ? NODE_SCRIPT_HISTORY_LIBRARY_FORMAT_VERSION
          : NODE_SCRIPT_HISTORY_FORMAT_VERSION,
    }),
    parseHeader: (value) => nodeScriptHistoryHeaderSchema.parse(value),
    parseSeal: (value) => nodeScriptHistorySealSchema.parse(value),
    parseIndex: (value) => value,
    scanRules: {
      journalLimitBytes: NODE_SERVER_HISTORY_LIMIT_BYTES,
      parseEntry: (value) => nodeScriptHistoryEntrySchema.parse(value),
      start: newNodeServerJournalProgress,
      accept: acceptNodeScriptEntry,
      citableOf: citableScriptEvent,
      // A recording keeps what a summary counts: everything but output and the storage-only source texts; a source entry stays only when its text was not stored, so the summary words it like the seal.
      keeps: (entry: NodeScriptHistoryEntry) =>
        entry.type === 'source'
          ? entry.sourceUnavailable !== undefined
          : entry.type !== 'output',
    },
    createWriter: (directory, header, onClosed, describeCause) =>
      new NodeScriptHistoryWriter(directory, header, onClosed, describeCause),
    verifySeal: ({ seal, entries, progress, hasIncompleteLine }) =>
      // A complete seal needs the whole story: the run's end.
      verifyRunSeal('Node script history', {
        seal,
        entries,
        hasIncompleteLine,
        storyIsWhole: progress.hasEnd,
      }),
    emptySummary: emptyNodeScriptSummary,
    summarize: ({ history, materialContent, materialRevision }) => {
      const { header, entries, seal } = history
      const end = entries.find((entry) => entry.type === 'end')
      const summary: NodeScriptHistorySummary = {
        ...emptyNodeScriptSummary(header),
        ...summarizeRunEvidence({
          status: history.status,
          reason: history.reason,
          entries,
          // A sealed history keeps its reasons as sealed (identical after a restart); any other is judged from its journal now.
          reasons:
            seal?.reasons ??
            evaluateNodeScriptCapture(header, entries, {
              interrupted: history.status === 'interrupted',
            }),
          learning: evaluateNodeScriptLearning(
            entries,
            materialContent ? citedSequencesOf(materialContent) : undefined,
          ),
          materialContent,
          materialRevision,
        }),
        ...(end
          ? {
              endKind: end.kind,
              ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
            }
          : {}),
      }
      return { summary }
    },
  }
