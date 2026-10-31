import type {
  ExtensionHistoryEntry,
  ExtensionHistoryHeader,
  ExtensionHistorySeal,
  ExtensionHistorySealReason,
} from './chromeExtensionHistorySchemas'
import type { ChromeExtensionHistoryWriter } from './chromeExtensionHistoryWriter'
import type {
  HistoryMaterialBase,
  HistorySummaryBase,
} from './historyStorageDescriptor'
import type { ExtensionJournalProgress } from './utils/extensionHistoryJournalRules'

/**
 * One chrome-extension history as the library and the history resources read it: the question, the extension, the surface, how far the run got and what the capture misses. A history whose journal does not verify reads `unavailable` with its header's identity and the reason.
 * The learning fields (`learningCoverage`, `learningMissing`, the title and the material revision) belong to the save path and join this type with it.
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
}

/** The types the chrome-extension profile fixes, for {@link NodeHistoryStore}. */
export type ExtensionHistoryTypes = {
  Header: ExtensionHistoryHeader
  Entry: ExtensionHistoryEntry
  Seal: ExtensionHistorySeal
  Progress: ExtensionJournalProgress
  Summary: ExtensionHistorySummary
  /** Learning material is saved by the save path; until it lands the profile offers only the base shape. */
  Material: HistoryMaterialBase
  MaterialContent: HistoryMaterialBase['content']
  Writer: ChromeExtensionHistoryWriter
}
