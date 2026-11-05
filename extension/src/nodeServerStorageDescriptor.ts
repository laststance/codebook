import {
  NODE_SERVER_HISTORY_DIRECTORY,
  NODE_SERVER_HISTORY_HEADER_FORMAT_VERSION,
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
  nodeServerHistoryEntrySchema,
  nodeServerHistoryHeaderSchema,
  nodeServerHistorySealSchema,
  type NodeServerHistoryEntry,
  type NodeServerHistoryHeader,
} from './nodeServerHistorySchemas'
import type {
  NodeServerHistorySummary,
  NodeServerHistoryTypes,
} from './nodeServerHistoryTypes'
import { NodeServerHistoryWriter } from './nodeServerHistoryWriter'
import {
  nodeServerLearningMaterialContentSchema,
  nodeServerLearningMaterialSchema,
} from './nodeServerLearningSchemas'
import { evaluateNodeServerCapture } from './utils/evaluateNodeServerCapture'
import { evaluateNodeServerLearning } from './utils/evaluateNodeServerLearning'
import { maskSecretQueryValues } from './utils/maskSecretQueryValues'
import {
  acceptNodeServerEntry,
  newNodeServerJournalProgress,
} from './utils/nodeServerJournalRules'
import type { CitableEvent } from './utils/recordingJournalScan'

/**
 * Reduces a server entry to what a learning step may cite: the request, a stop (by its source hash), an output (by its channel), the response or the request failure; the storage-only entries (`source`, `end`, the send marks) are never citable.
 * @param entry - A journal entry.
 * @returns The citable form, or `undefined` for an entry no step may cite.
 * @example citableServerEvent(outputEntry) // => { type: 'output', channel: 'stdout' }
 */
function citableServerEvent(
  entry: NodeServerHistoryEntry,
): CitableEvent | undefined {
  switch (entry.type) {
    case 'stop':
    case 'output':
      return citableRunEvidenceEvent(entry)
    case 'request':
    case 'response':
    case 'request-failed':
      return { type: entry.type }
    default:
      return undefined
  }
}

/**
 * Starts a server history's summary from its header, with nothing counted yet; the store fills in what the verified journal says, and an unavailable history keeps these values.
 * @param header - The history's header.
 * @returns A summary with the header's identity, question and request line, and no evidence.
 * @example emptyNodeServerSummary(header).requestLine // => 'POST /api/x'
 */
function emptyNodeServerSummary(
  header: NodeServerHistoryHeader,
): NodeServerHistorySummary {
  return {
    studyId: header.studyId,
    createdAt: header.createdAt,
    profile: 'node-server',
    status: 'partial',
    verification: 'unavailable',
    question: header.question,
    // Masked again: a header saved before `code` was masked kept the callback code in its declared request path, and the catalog and the Saved studies row show this line.
    requestLine: `${header.declaredRequest.method} ${maskSecretQueryValues(header.declaredRequest.path)}`,
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
 * The node-server profile's storage descriptor: `node-servers.v1/`, the server header and entries, the structured seal and the shared journal rules. Give it to a {@link NodeHistoryStore} to read, write, list and delete server histories; no live code produces one yet.
 * @example new NodeHistoryStore(nodeServerStorageDescriptor, learningDirectory, workspaceKey, capacity, savedStudyCount)
 */
export const nodeServerStorageDescriptor: HistoryStorageDescriptor<NodeServerHistoryTypes> =
  {
    profile: 'node-server',
    directoryName: NODE_SERVER_HISTORY_DIRECTORY,
    journalLimitBytes: NODE_SERVER_HISTORY_LIMIT_BYTES,
    sealLimitBytes: NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES,
    words: {
      interruptedPrefix:
        'Interrupted Node server history after its verified prefix:',
      noSeal: 'Node server history has no verified final seal.',
      subject: 'Node server history',
    },
    learningMaterial: buildNodeRunLearningCodec<NodeServerHistoryTypes>(
      nodeServerLearningMaterialSchema,
      nodeServerLearningMaterialContentSchema,
    ),
    stampHeader: (input) => ({
      ...input,
      formatVersion: NODE_SERVER_HISTORY_HEADER_FORMAT_VERSION,
    }),
    parseHeader: (value) => nodeServerHistoryHeaderSchema.parse(value),
    parseSeal: (value) => nodeServerHistorySealSchema.parse(value),
    parseIndex: (value) => value,
    scanRules: {
      journalLimitBytes: NODE_SERVER_HISTORY_LIMIT_BYTES,
      parseEntry: (value) => nodeServerHistoryEntrySchema.parse(value),
      start: newNodeServerJournalProgress,
      accept: acceptNodeServerEntry,
      citableOf: citableServerEvent,
      // A recording keeps what a summary counts: everything but output and the storage-only source texts; a source entry stays only when its text was not stored, so the summary words it like the seal.
      keeps: (entry: NodeServerHistoryEntry) =>
        entry.type === 'source'
          ? entry.sourceUnavailable !== undefined
          : entry.type !== 'output',
    },
    createWriter: (directory, header, onClosed, describeCause) =>
      new NodeServerHistoryWriter(directory, header, onClosed, describeCause),
    verifySeal: ({ seal, entries, progress, hasIncompleteLine }) =>
      // A complete seal needs the whole story: the request closed by its terminal entry and the run's end.
      verifyRunSeal('Node server history', {
        seal,
        entries,
        hasIncompleteLine,
        storyIsWhole: progress.hasEnd && progress.hasTerminal,
      }),
    emptySummary: emptyNodeServerSummary,
    summarize: ({ history, materialContent, materialRevision }) => {
      const { header, entries, seal } = history
      const response = entries.find((entry) => entry.type === 'response')
      const failure = entries.find((entry) => entry.type === 'request-failed')
      const summary: NodeServerHistorySummary = {
        ...emptyNodeServerSummary(header),
        ...summarizeRunEvidence({
          status: history.status,
          reason: history.reason,
          entries,
          // A sealed history keeps its reasons as sealed (identical after a restart); any other is judged from its journal now.
          reasons:
            seal?.reasons ??
            evaluateNodeServerCapture(header, entries, {
              interrupted: history.status === 'interrupted',
            }),
          learning: evaluateNodeServerLearning(
            entries,
            materialContent ? citedSequencesOf(materialContent) : undefined,
          ),
          materialContent,
          materialRevision,
        }),
        ...(response ? { responseStatus: response.status } : {}),
        ...(failure ? { requestFailureCode: failure.code } : {}),
      }
      return { summary }
    },
  }
