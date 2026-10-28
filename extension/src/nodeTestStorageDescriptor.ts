import {
  NODE_TEST_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_LIMIT_BYTES,
  NODE_TEST_HISTORY_SEAL_LIMIT_BYTES,
} from './constants'
import type { HistoryStorageDescriptor } from './historyStorageDescriptor'
import {
  nodeTestHistoryHeaderSchema,
  nodeTestHistoryIndexSchema,
  nodeTestHistorySealSchema,
  type NodeTestHistoryHeader,
  type NodeTestHistoryIndex,
  type NodeTestLearningMaterialContent,
} from './nodeTestHistorySchemas'
import type {
  NodeTestHistorySummary,
  NodeTestHistoryTypes,
} from './nodeTestHistoryTypes'
import { NodeTestHistoryWriter } from './nodeTestHistoryWriter'
import { describeNodeTestResult } from './utils/describeNodeTestResult'
import {
  listMissingNodeExplanations,
  type NodeLearningNeeds,
} from './utils/listMissingNodeExplanations'
import { listMissingNodeLearning } from './utils/listMissingNodeLearning'
import { nodeTestResultKind } from './utils/nodeTestResultKind'
import { NODE_TEST_SCAN_RULES } from './utils/recordingJournalScan'

/**
 * Starts a test history's summary from its header, with nothing counted yet; the store fills in what the verified journal says, and an unavailable history keeps these values.
 * @param header - The history's header.
 * @returns A summary with the header's identity, the cited test, no result and no learning.
 * @example emptyNodeTestSummary(header).verdict // => 'No result recorded'
 */
function emptyNodeTestSummary(
  header: NodeTestHistoryHeader,
): NodeTestHistorySummary {
  return {
    studyId: header.studyId,
    createdAt: header.createdAt,
    profile: header.profile,
    status: 'partial',
    verification: 'unavailable',
    testFile: header.configuration.testFile,
    ...(header.configuration.testTitles
      ? { testTitles: header.configuration.testTitles }
      : {}),
    verdict: 'No result recorded',
    testResult: 'none',
    stopCount: 0,
    explainedStopCount: 0,
    learningCoverage: 'none',
    learningMissing: [],
    captureMissing: [],
    materialRevision: 0,
  }
}

/**
 * The node-test profile's storage descriptor: today's folder, header, entries, seal, order rules and summary, unchanged. {@link NodeTestHistoryStore} uses it unless it is given another, so existing callers and histories need no edit.
 * @example new NodeTestHistoryStore(directory, workspaceKey) // uses this descriptor
 */
export const nodeTestStorageDescriptor: HistoryStorageDescriptor<NodeTestHistoryTypes> =
  {
    profile: 'node-test',
    directoryName: NODE_TEST_HISTORY_DIRECTORY,
    journalLimitBytes: NODE_TEST_HISTORY_LIMIT_BYTES,
    sealLimitBytes: NODE_TEST_HISTORY_SEAL_LIMIT_BYTES,
    words: {
      interruptedPrefix: 'Interrupted Node history after its verified prefix:',
      noSeal: 'Node test history has no verified final seal.',
      subject: 'Node history',
    },
    supportsLearningMaterial: true,
    stampHeader: (input) => ({ ...input, version: 1 }),
    parseHeader: (value) => nodeTestHistoryHeaderSchema.parse(value),
    parseSeal: (value) => nodeTestHistorySealSchema.parse(value),
    parseIndex: (value) => nodeTestHistoryIndexSchema.parse(value),
    scanRules: NODE_TEST_SCAN_RULES,
    createWriter: (directory, header, onClosed) =>
      new NodeTestHistoryWriter(directory, header, onClosed),
    verifySeal: ({ seal, header, entries, progress, hasIncompleteLine }) => {
      if (
        hasIncompleteLine ||
        seal.entryCount !== entries.length ||
        (seal.status === 'complete' &&
          (!progress.hasResult ||
            !progress.passingResult ||
            progress.stopCount !==
              1 + (header.configuration.additionalStops?.length ?? 0)))
      )
        throw new Error(
          'Sealed Node history does not contain its required passing result and ordered stops.',
        )
    },
    emptySummary: emptyNodeTestSummary,
    summarize({
      history,
      materialContent,
      materialRevision,
    }: {
      history: Pick<
        NodeTestHistoryIndex,
        'header' | 'entries' | 'status' | 'reason'
      >
      materialContent?: NodeTestLearningMaterialContent
      materialRevision?: number
    }) {
      const missing = listMissingNodeLearning(history, materialContent)
      const result = history.entries.find((entry) => entry.type === 'result')
      const stops = history.entries.filter((entry) => entry.type === 'stop')
      const needs: NodeLearningNeeds = {
        stopSequences: stops.map((stop) => stop.sequence),
        ...(result ? { resultSequence: result.sequence } : {}),
      }
      const summary: NodeTestHistorySummary = {
        ...emptyNodeTestSummary(history.header),
        status: history.status,
        ...(history.reason ? { reason: history.reason } : {}),
        verification: 'verified',
        verdict: describeNodeTestResult(result),
        testResult: nodeTestResultKind(result),
        stopCount: stops.length,
        explainedStopCount:
          stops.length -
          missing.explanations.filter((part) => part.kind === 'stop').length,
        learningCoverage: missing.coverage,
        learningMissing: missing.explanations,
        captureMissing: missing.capture,
        materialRevision: materialRevision ?? 0,
      }
      return { summary, needs }
    },
    applyMaterial({
      summary,
      needs,
      materialContent,
      materialRevision,
    }: {
      summary: NodeTestHistorySummary
      needs: NodeLearningNeeds
      materialContent?: NodeTestLearningMaterialContent
      materialRevision: number
    }) {
      const { missing, coverage } = listMissingNodeExplanations(
        needs,
        materialContent,
      )
      return {
        ...summary,
        explainedStopCount:
          summary.stopCount -
          missing.filter((part) => part.kind === 'stop').length,
        learningCoverage: coverage,
        learningMissing: missing,
        materialRevision,
      }
    },
  }
