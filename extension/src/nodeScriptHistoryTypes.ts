import type {
  NodeScriptHistoryEntry,
  NodeScriptHistoryHeader,
  NodeScriptHistorySeal,
} from './nodeScriptHistorySchemas'
import type { NodeScriptHistoryWriter } from './nodeScriptHistoryWriter'
import type {
  NodeScriptLearningMaterial,
  NodeScriptLearningMaterialContent,
} from './nodeScriptLearningSchemas'
import type { NodeServerSealReason } from './nodeServerHistorySchemas'
import type { NodeScriptLearningPart } from './utils/evaluateNodeScriptLearning'
import type { NodeServerLearningCoverage } from './utils/evaluateNodeServerLearning'
import type { NodeServerJournalProgress } from './utils/nodeServerJournalRules'

/**
 * One script history as the library and the history resources read it: the entry, how the run ended, the stops, and the three verdicts. A history whose journal does not verify reads `unavailable` with its header's identity and the reason.
 * The lists are capped for an answer ({@link capMissingList}); the seal keeps every reason.
 */
export type NodeScriptHistorySummary = {
  studyId: string
  createdAt: string
  profile: 'node-script'
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  reason?: string
  verification: 'verified' | 'unavailable'
  question: string
  /** The saved learning title, absent before the chat saved its explanation. */
  title?: string
  /** The script's entry file, repository-relative. */
  entry: string
  /** How the run ended, absent while it records or when the journal has no `end`. */
  endKind?: 'exited' | 'signal' | 'stopped' | 'limit'
  /** The script's exit code, when it exited and the code was read. */
  exitCode?: number | null
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
  learningMissing: NodeScriptLearningPart[]
  learningMissingCount: number
  materialRevision: number
}

/** The types the node-script profile fixes. */
export type NodeScriptHistoryTypes = {
  Header: NodeScriptHistoryHeader
  Entry: NodeScriptHistoryEntry
  Seal: NodeScriptHistorySeal
  Progress: NodeServerJournalProgress
  Summary: NodeScriptHistorySummary
  Material: NodeScriptLearningMaterial
  MaterialContent: NodeScriptLearningMaterialContent
  Writer: NodeScriptHistoryWriter
}
