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
  type ExtensionHistoryJournalLimits,
} from './chromeExtensionHistoryWriter'
import {
  chromeExtensionLearningMaterialContentSchema,
  chromeExtensionLearningMaterialSchema,
} from './chromeExtensionLearningSchemas'
import {
  CHROME_EXTENSION_HISTORY_DIRECTORY,
  CHROME_EXTENSION_HISTORY_FORMAT_VERSION,
  CHROME_EXTENSION_PROFILE,
  EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
  EXTENSION_HISTORY_REASON_CODES as CODES,
  EXTENSION_HISTORY_SEAL_LIMIT_BYTES,
  NODE_TEST_LEARNING_MATERIAL_VERSION,
} from './constants'
import type { HistoryStorageDescriptor } from './historyStorageDescriptor'
import { assertNodeLearningCitations } from './utils/assertNodeLearningCitations'
import { evaluateExtensionHistoryCapture } from './utils/evaluateExtensionHistoryCapture'
import { evaluateExtensionLearning } from './utils/evaluateExtensionLearning'
import {
  acceptExtensionHistoryEntry,
  newExtensionJournalProgress,
  type ExtensionJournalProgress,
} from './utils/extensionHistoryJournalRules'
import type { CitableEvent } from './utils/recordingJournalScan'
import { removeTemporaryFrameBlobs } from './utils/removeTemporaryFrameBlobs'

/** The reasons a history still recording cannot be blamed for yet: stops later in the run, the result and the filmstrip are still to come. */
const RECORDING_PENDING_CODES: readonly string[] = [
  CODES.stopNotReached,
  CODES.resultMissing,
  CODES.filmstripMissing,
  CODES.snapshotMissing,
  // A pin may still be on its way while the run lives.
  CODES.pinnedFrameMissing,
]

/**
 * Reduces an entry to what a learning step may cite: a capture (by its source hash and the context, target URL and worker generation of its pause), a pause, and the result.
 * @param entry - A journal entry.
 * @param progress - What the journal established through this entry; its pause supplies the capture's context.
 * @returns The citable form, or `undefined` for an entry no step may cite.
 * @example citableExtensionEvent(resultEntry, progress) // => { type: 'result' }
 */
function citableExtensionEvent(
  entry: ExtensionHistoryEntry,
  progress: ExtensionJournalProgress,
): CitableEvent | undefined {
  if (entry.type === 'pause-open')
    return {
      type: 'pause',
      context: entry.context,
      targetUrl: entry.targetUrl,
      workerGeneration: entry.workerGeneration,
      stopIndex: entry.stopIndex,
    }
  if (entry.type === 'capture') {
    const pause = progress.pauses.get(entry.pauseId)
    return {
      type: 'stop',
      sourceHash: entry.sourceHash,
      path: entry.path,
      line: entry.line,
      ...(pause
        ? {
            context: pause.context,
            targetUrl: pause.targetUrl,
            workerGeneration: pause.workerGeneration,
          }
        : {}),
    }
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
    learningCoverage: 'none',
    learningMissing: [],
    materialRevision: 0,
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
  limits?: ExtensionHistoryJournalLimits
}): HistoryStorageDescriptor<ExtensionHistoryTypes> {
  return {
    profile: CHROME_EXTENSION_PROFILE,
    directoryName: CHROME_EXTENSION_HISTORY_DIRECTORY,
    removable: true,
    journalLimitBytes: EXTENSION_HISTORY_JOURNAL_LIMIT_BYTES,
    sealLimitBytes: EXTENSION_HISTORY_SEAL_LIMIT_BYTES,
    words: {
      interruptedPrefix:
        'Interrupted Chrome extension history after its verified prefix:',
      noSeal: 'Chrome extension history has no verified final seal.',
      subject: 'Chrome extension history',
    },
    learningMaterial: {
      parseMaterial: (value) =>
        chromeExtensionLearningMaterialSchema.parse(value),
      parseContent: (value) =>
        chromeExtensionLearningMaterialContentSchema.parse(value),
      buildMaterial: (input) =>
        chromeExtensionLearningMaterialSchema.parse({
          version: NODE_TEST_LEARNING_MATERIAL_VERSION,
          ...input,
        }),
      assertCitations: (content, citable, lead): void =>
        assertNodeLearningCitations(content, citable, {
          lead,
          withNearest: true,
        }),
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
        options?.limits,
      ),
    discardInterruptedLeftovers: removeTemporaryFrameBlobs,
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
    summarize: ({ history, materialContent, materialRevision }) => {
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
      const cited = new Set(
        (materialContent?.steps ?? []).flatMap((step) =>
          step.reference ? [step.reference.sequence] : [],
        ),
      )
      const learning = evaluateExtensionLearning(
        entries,
        materialContent ? cited : undefined,
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
          learningCoverage: learning.coverage,
          learningMissing: learning.missing,
          // The saved material's question replaces the header's provisional one; without material the header's stands.
          ...(materialContent
            ? {
                title: materialContent.title,
                question: materialContent.question,
              }
            : {}),
          materialRevision: materialRevision ?? 0,
        },
      }
    },
  }
}

/** The chrome-extension profile's descriptor with the real run clock; the repository's store uses it. */
export const chromeExtensionStorageDescriptor =
  createExtensionStorageDescriptor()
