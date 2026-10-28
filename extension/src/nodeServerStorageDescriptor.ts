import {
  NODE_SERVER_HISTORY_DIRECTORY,
  NODE_SERVER_HISTORY_LIMIT_BYTES,
  NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES,
} from './constants'
import type { HistoryStorageDescriptor } from './historyStorageDescriptor'
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
import { capMissingList } from './utils/capMissingList'
import { evaluateNodeServerCapture } from './utils/evaluateNodeServerCapture'
import { evaluateNodeServerLearning } from './utils/evaluateNodeServerLearning'
import {
  acceptNodeServerEntry,
  newNodeServerJournalProgress,
} from './utils/nodeServerJournalRules'

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
    requestLine: `${header.declaredRequest.method} ${header.declaredRequest.path}`,
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
    supportsLearningMaterial: false,
    stampHeader: (input) => ({ ...input, formatVersion: 1 }),
    parseHeader: (value) => nodeServerHistoryHeaderSchema.parse(value),
    parseSeal: (value) => nodeServerHistorySealSchema.parse(value),
    parseIndex: (value) => value,
    scanRules: {
      journalLimitBytes: NODE_SERVER_HISTORY_LIMIT_BYTES,
      parseEntry: (value) => nodeServerHistoryEntrySchema.parse(value),
      start: newNodeServerJournalProgress,
      accept: acceptNodeServerEntry,
      // Server entries are not citable until their learning material arrives.
      citableOf: () => undefined,
      // A recording keeps what a summary counts: everything but output and the storage-only source texts.
      keeps: (entry: NodeServerHistoryEntry) =>
        entry.type !== 'output' && entry.type !== 'source',
    },
    createWriter: (directory, header, onClosed, describeCause) =>
      new NodeServerHistoryWriter(directory, header, onClosed, describeCause),
    verifySeal: ({ seal, entries, progress, hasIncompleteLine }) => {
      if (
        hasIncompleteLine ||
        seal.entryCount !== entries.length ||
        // A complete seal needs the whole story: the request closed by its terminal entry and the run's end.
        (seal.status === 'complete' &&
          !(progress.hasEnd && progress.hasTerminal))
      )
        throw new Error(
          'Sealed Node server history does not contain what its seal claims.',
        )
    },
    emptySummary: emptyNodeServerSummary,
    summarize: ({ history }) => {
      const { header, entries, seal } = history
      const stops = entries.filter((entry) => entry.type === 'stop')
      const response = entries.find((entry) => entry.type === 'response')
      const failure = entries.find((entry) => entry.type === 'request-failed')
      // A sealed history keeps its reasons as sealed (identical after a restart); any other is judged from its journal now.
      const reasons =
        seal?.reasons ?? evaluateNodeServerCapture(header, entries)
      const capture = capMissingList(reasons)
      const learning = evaluateNodeServerLearning(entries, undefined)
      const learningMissing = capMissingList(learning.missing)
      const summary: NodeServerHistorySummary = {
        ...emptyNodeServerSummary(header),
        status: history.status,
        ...(history.reason ? { reason: history.reason } : {}),
        verification: 'verified',
        ...(response ? { responseStatus: response.status } : {}),
        ...(failure ? { requestFailureCode: failure.code } : {}),
        stopCount: stops.length,
        reachedStopCount: new Set(stops.map((stop) => stop.declaredStopIndex))
          .size,
        captureComplete: reasons.length === 0,
        captureMissing: capture.items,
        captureMissingCount: capture.count,
        learningCoverage: learning.coverage,
        learningMissing: learningMissing.items,
        learningMissingCount: learningMissing.count,
      }
      return { summary }
    },
  }
