import {
  extensionHistorySealSchema,
  parseExtensionHistoryEntry,
  parseExtensionHistoryHeader,
  type ExtensionHistoryEntry,
  type ExtensionHistoryHeader,
} from './chromeExtensionHistorySchemas'
import type {
  ExtensionHistorySummary,
  ExtensionHistoryTypes,
} from './chromeExtensionHistoryTypes'
import {
  ChromeExtensionHistoryWriter,
  type ExtensionHistoryClock,
} from './chromeExtensionHistoryWriter'
import {
  CHROME_EXTENSION_HISTORY_DIRECTORY,
  CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
  CHROME_EXTENSION_PROFILE,
  EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
  EXTENSION_HISTORY_REASON_CODES as CODES,
  EXTENSION_HISTORY_SEAL_LIMIT_BYTES,
} from './constants'
import type { HistoryStorageDescriptor } from './historyStorageDescriptor'
import { evaluateExtensionHistoryCapture } from './utils/evaluateExtensionHistoryCapture'
import {
  acceptExtensionHistoryEntry,
  newExtensionJournalProgress,
} from './utils/extensionHistoryJournalRules'
import type { CitableEvent } from './utils/recordingJournalScan'

/** The reasons a history still recording cannot be blamed for yet: stops later in the run, the result and the filmstrip are still to come. */
const RECORDING_PENDING_CODES: readonly string[] = [
  CODES.stopNotReached,
  CODES.resultMissing,
  CODES.filmstripMissing,
  CODES.snapshotMissing,
]

/**
 * Reduces an entry to what a learning step may cite for now: a capture (by its source hash) and the result; the save path widens this with the stop's context.
 * @param entry - A journal entry.
 * @returns The citable form, or `undefined` for an entry no step may cite.
 * @example citableExtensionEvent(resultEntry) // => { type: 'result' }
 */
function citableExtensionEvent(
  entry: ExtensionHistoryEntry,
): CitableEvent | undefined {
  if (entry.type === 'capture')
    return {
      type: 'stop',
      sourceHash: entry.sourceHash,
      path: entry.path,
      line: entry.line,
    }
  return entry.type === 'result' ? { type: 'result' } : undefined
}

/**
 * Starts an extension history's summary from its header, with nothing counted yet; the store fills in what the verified journal says, and an unavailable history keeps these values.
 * @param header - The history's header.
 * @returns A summary with the header's identity, question, extension and surface, and no evidence.
 * @example emptyExtensionSummary(header).extensionName // => 'Notes'
 */
function emptyExtensionSummary(
  header: ExtensionHistoryHeader,
): ExtensionHistorySummary {
  return {
    studyId: header.studyId,
    createdAt: header.createdAt,
    profile: CHROME_EXTENSION_PROFILE,
    status: 'partial',
    verification: 'unavailable',
    question: header.question,
    extensionName: header.extension.name,
    extensionVersion: header.extension.version,
    surfaceKind: header.surface.kind,
    declaredStopCount: header.declaredStops.length,
    reachedStopCount: 0,
    stopCount: 0,
    capturedStopCount: 0,
    captureComplete: false,
    captureMissing: [],
  }
}

/**
 * Makes the chrome-extension profile's storage descriptor: `chrome-extensions.v1/`, the extension header and entries, the structured seal and the shared journal rules. Give it to a {@link NodeHistoryStore} to read, write, list and delete extension histories.
 * @param options - `now` names the run clock the writers stamp entries with; a test passes its own.
 * @returns The descriptor.
 * @example new NodeHistoryStore(createExtensionStorageDescriptor(), learningDirectory, workspaceKey, capacity, savedStudyCount)
 */
export function createExtensionStorageDescriptor(options?: {
  now?: ExtensionHistoryClock
}): HistoryStorageDescriptor<ExtensionHistoryTypes> {
  return {
    profile: CHROME_EXTENSION_PROFILE,
    directoryName: CHROME_EXTENSION_HISTORY_DIRECTORY,
    journalLimitBytes: EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
    sealLimitBytes: EXTENSION_HISTORY_SEAL_LIMIT_BYTES,
    words: {
      interruptedPrefix:
        'Interrupted Chrome extension history after its verified prefix:',
      noSeal: 'Chrome extension history has no verified final seal.',
      subject: 'Chrome extension history',
    },
    // The save path replaces this codec; until then no material exists to parse and none is offered.
    learningMaterial: {
      parseMaterial: refuseMaterial,
      parseContent: refuseMaterial,
      buildMaterial: refuseMaterial,
      assertCitations: refuseMaterial,
    },
    stampHeader: (input) => ({
      ...input,
      formatVersion: CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
    }),
    parseHeader: parseExtensionHistoryHeader,
    parseSeal: (value) => extensionHistorySealSchema.parse(value),
    parseIndex: (value) => value,
    scanRules: {
      journalLimitBytes: EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
      parseEntry: parseExtensionHistoryEntry,
      start: newExtensionJournalProgress,
      accept: acceptExtensionHistoryEntry,
      citableOf: citableExtensionEvent,
      // A recording keeps what a summary counts: everything but the frames, which can be thousands.
      keeps: (entry) => entry.type !== 'frame',
    },
    createWriter: (directory, header, onClosed, describeCause) =>
      new ChromeExtensionHistoryWriter(
        directory,
        header,
        onClosed,
        describeCause,
        options?.now,
      ),
    verifySeal: ({ seal, entries, progress, hasIncompleteLine }): void => {
      if (
        hasIncompleteLine ||
        seal.entryCount !== entries.length ||
        // A complete seal needs the whole story: a result.
        (seal.status === 'complete' && !progress.hasResult)
      )
        throw new Error(
          'Sealed Chrome extension history does not contain what its seal claims.',
        )
    },
    emptySummary: emptyExtensionSummary,
    summarize: ({ history }) => {
      const { header, entries, seal } = history
      const opened = entries.filter((entry) => entry.type === 'pause-open')
      const result = entries.find((entry) => entry.type === 'result')
      // A sealed history keeps its reasons as sealed (identical after a restart); any other is judged from its journal now.
      const reasons =
        seal?.reasons ??
        evaluateExtensionHistoryCapture(header, entries, {
          // A history still recording has not missed its filmstrip yet; the seal decides it.
          filmstripIncomplete: false,
        }).filter(
          (reason) =>
            history.status !== 'recording' ||
            !RECORDING_PENDING_CODES.includes(reason.code),
        )
      return {
        summary: {
          ...emptyExtensionSummary(header),
          status: history.status,
          ...(history.reason ? { reason: history.reason } : {}),
          verification: 'verified',
          stopCount: opened.length,
          reachedStopCount: new Set(opened.map((pause) => pause.stopIndex))
            .size,
          capturedStopCount: entries.filter((entry) => entry.type === 'capture')
            .length,
          ...(result ? { resultOutcome: result.outcome } : {}),
          captureComplete: reasons.length === 0,
          captureMissing: reasons,
        },
      }
    },
  }
}

/** Refuses a learning material of a chrome-extension history until the save path exists. @throws Always. */
function refuseMaterial(): never {
  throw new Error(
    'Learning material for a Chrome extension history is saved by the save path.',
  )
}

/** The chrome-extension profile's descriptor with the real run clock; the repository's store uses it. */
export const chromeExtensionStorageDescriptor =
  createExtensionStorageDescriptor()
