import type {
  ExtensionHistoryEntry,
  ExtensionHistoryHeader,
  ExtensionHistorySeal,
  ExtensionHistorySealReason,
} from './chromeExtensionHistorySchemas'
import type { ChromeExtensionHistoryWriter } from './chromeExtensionHistoryWriter'
import type {
  ChromeExtensionLearningMaterial,
  ChromeExtensionLearningMaterialContent,
} from './chromeExtensionLearningSchemas'
import type { HistorySummaryBase } from './historyStorageDescriptor'
import type {
  ExtensionLearningCoverage,
  ExtensionLearningPart,
} from './utils/evaluateExtensionLearning'
import type { ExtensionJournalProgress } from './utils/extensionHistoryJournalRules'

/**
 * One chrome-extension history as the library and the history resources read it: the question, the extension, the surface, how far the run got and what the capture misses. A history whose journal does not verify reads `unavailable` with its header's identity and the reason.
 * `learningCoverage`, `learningMissing`, the title and the material revision are the saved learning material's verdicts (`none` before the chat saved any).
 */
export type ExtensionHistorySummary = HistorySummaryBase & {
  profile: 'chrome-extension'
  question: string
  extensionName: string
  extensionVersion: string
  surfaceKind: ExtensionHistoryHeader['surface']['kind']
  declaredStopCount: number
  /** The distinct declared stops with at least one recorded pause. */
  reachedStopCount: number
  /** Recorded pauses (`pause-open` entries). */
  stopCount: number
  /** Recorded captures (stops whose values and source were read). */
  capturedStopCount: number
  /** The recorded result, absent before the run observed one. */
  resultOutcome?: Extract<ExtensionHistoryEntry, { type: 'result' }>['outcome']
  /** Whether the capture is complete: no partial reason. */
  captureComplete: boolean
  /** The reasons the capture misses a part, as the seal keeps them (judged from the journal for an unsealed history). */
  captureMissing: ExtensionHistorySealReason[]
  /** The saved learning title, absent before the chat saved its explanation. */
  title?: string
  learningCoverage: ExtensionLearningCoverage
  /** Every citation the material still owes, in journal order. */
  learningMissing: ExtensionLearningPart[]
  materialRevision: number
}

/** The types the chrome-extension profile fixes, for {@link NodeHistoryStore}. */
export type ExtensionHistoryTypes = {
  Header: ExtensionHistoryHeader
  Entry: ExtensionHistoryEntry
  Seal: ExtensionHistorySeal
  Progress: ExtensionJournalProgress
  Summary: ExtensionHistorySummary
  Material: ChromeExtensionLearningMaterial
  MaterialContent: ChromeExtensionLearningMaterialContent
  Writer: ChromeExtensionHistoryWriter
}
