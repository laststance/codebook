import type {
  NodeTestHistoryEntry,
  NodeTestHistoryHeader,
  NodeTestHistoryIndex,
  NodeTestHistorySeal,
} from './nodeTestHistorySchemas'
import type { NodeTestHistoryWriter } from './nodeTestHistoryWriter'
import type { NodeTestVerdict } from './utils/describeNodeTestResult'
import type {
  NodeLearningCoverage,
  NodeLearningExplanationPart,
} from './utils/listMissingNodeExplanations'
import type { NodeLearningCapturePart } from './utils/listMissingNodeLearning'
import type { NodeTestResultKind } from './utils/nodeTestResultKind'
import type { JournalProgress } from './utils/recordingJournalScan'

/**
 * One test history as Saved studies, the `codebook://node-history` resources and Save read it: one projection per history, so the three agree (plan version 7, Design 13).
 * A history whose journal does not verify reads `unavailable` with its header's identity and the reason; its learning fields then say nothing was checked.
 */
export type NodeTestHistorySummary = {
  studyId: string
  createdAt: string
  profile: 'node-test'
  status: NodeTestHistoryIndex['status']
  reason?: string
  verification: 'verified' | 'unavailable'
  /** The cited test file and its title path, as the header names them, for labels such as a failed open's notification. */
  testFile: string
  testTitles?: string[]
  verdict: NodeTestVerdict
  testResult: NodeTestResultKind
  stopCount: number
  explainedStopCount: number
  learningCoverage: NodeLearningCoverage
  learningMissing: NodeLearningExplanationPart[]
  captureMissing: NodeLearningCapturePart[]
  /** The revision of the learning material the summary counted; 0 before the first save. */
  materialRevision: number
}

/** The types the node-test profile fixes; the default of {@link NodeTestHistoryStore}. */
export type NodeTestHistoryTypes = {
  Header: NodeTestHistoryHeader
  Entry: NodeTestHistoryEntry
  Seal: NodeTestHistorySeal
  Progress: JournalProgress
  Summary: NodeTestHistorySummary
  Writer: NodeTestHistoryWriter
}
