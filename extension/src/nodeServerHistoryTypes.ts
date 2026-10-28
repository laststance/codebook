import type {
  NodeServerHistoryEntry,
  NodeServerHistoryHeader,
  NodeServerHistorySeal,
  NodeServerSealReason,
} from './nodeServerHistorySchemas'
import type { NodeServerHistoryWriter } from './nodeServerHistoryWriter'
import type {
  NodeServerLearningCoverage,
  NodeServerLearningPart,
} from './utils/evaluateNodeServerLearning'
import type { NodeServerJournalProgress } from './utils/nodeServerJournalRules'

/**
 * One server history as the library and the history resources read it: the request line, its answer, the stops, and the three verdicts. A history whose journal does not verify reads `unavailable` with its header's identity and the reason.
 * The lists are capped for an answer ({@link capMissingList}); the seal keeps every reason.
 */
export type NodeServerHistorySummary = {
  studyId: string
  createdAt: string
  profile: 'node-server'
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  reason?: string
  verification: 'verified' | 'unavailable'
  question: string
  /** The declared request as the header stores it, `POST /api/x`. */
  requestLine: string
  /** The recorded response status, absent before a response. */
  responseStatus?: number
  /** The code of a recorded request failure. */
  requestFailureCode?: string
  declaredStopCount: number
  /** The distinct declared stops with at least one recorded hit. */
  reachedStopCount: number
  /** Recorded stop hits. */
  stopCount: number
  /** Whether the capture is complete: no partial reason. */
  captureComplete: boolean
  captureMissing: NodeServerSealReason[]
  captureMissingCount: number
  learningCoverage: NodeServerLearningCoverage
  learningMissing: NodeServerLearningPart[]
  learningMissingCount: number
  materialRevision: number
}

/** The types the node-server profile fixes. */
export type NodeServerHistoryTypes = {
  Header: NodeServerHistoryHeader
  Entry: NodeServerHistoryEntry
  Seal: NodeServerHistorySeal
  Progress: NodeServerJournalProgress
  Summary: NodeServerHistorySummary
  Writer: NodeServerHistoryWriter
}
