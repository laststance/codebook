import { STUDY_ARCHIVE_UNAVAILABLE_MESSAGE } from './constants'
import { newerStudyFormatMessage } from './utils/newerStudyFormatMessage'

export const ERROR_RECOVERY = {
  NOT_FOUND:
    'Read codebook_status and use a resource reference from the selected instance and run; for a Node test history, copy its studyId or historyUri from codebook://node-history.',
  STALE_INSTANCE:
    'Copy the current connection from the editor, initialize, and read codebook_status. Never replay input automatically.',
  STALE_PAUSE:
    'Read the run resource and use its current continue arguments only if resumable.',
  STALE_PLAYBACK:
    'Read the current playback URI and use its returned revision/study identity. Never retry by starting or continuing a run.',
  PRESENTATION_INSTANCE_GONE:
    'Read codebook_status and its presentation resource; the previous reader was closed. Copy the new presentationId and revision before an explicit selection.',
  STALE_PRESENTATION:
    'Read the current presentation resource and copy presentationControlRevision. After response loss inspect applied mode and layout confirmation; never retry application input.',
  PRESENTATION_UNAVAILABLE:
    'Read presentation state and its reason. Wait for input/capture/navigation to settle or restore the layout explicitly with current identities. For an open Study, call codebook_presentation with action focus, current mode and current identities to return from Wiki or another editor, then explicitly restore if needed. Never start or continue a run to repair a layout.',
  PLAYBACK_UNAVAILABLE:
    'Inspect playback and the selected recording for missing/corrupt data. Leave and reopen Recording after repair; playback never retries application input.',
  BUSY: 'Read the run resource and its nextActions. Do not send another click with a new key.',
  SOURCE_CHANGED:
    'At a start, a cited source open in the editor with text that differs from the article refuses the run before the application, test, browser or debugger starts; Codebook saves no document. During a repository-browser or node-test run, the same change ends the run at its next stop or before a continuation; that continuation sends no resume. Earlier committed observations and their captured source remain readable. Read the existing run and its captured source resources; ask the learner to save or revert the named file: after a save, read the source again and publish the article again; after a revert, change nothing. Then start a new deliberate run. Never retry application input automatically.',
  SOURCE_UNAVAILABLE:
    'Use codebook_sources to discover an eligible tracked path, then codebook_source to read its current hash. See codebook://help/repository for source boundaries.',
  STALE_SOURCE_CATALOG:
    'List codebook_sources again without a cursor; tracked paths or eligibility changed. No content or learner decision was modified.',
  BOOK_CONFLICT:
    'The message names what conflicts. For a revision conflict, publish the complete document with the current revision as expectedRevision to replace the book, or under another book id to keep it; read the latest revision when you build on its content or its learning identities. Reuse a key only with identical content and expectedRevision.',
  BOOK_UNAVAILABLE:
    'Read the repository catalog for the affected book and retry after repairing its named storage/reference problem. Existing history is retained; never run application input to repair documentation.',
  RUNTIME_FAILED:
    'Read the terminal reason and captured history. Stop owned resources; do not retry the click automatically.',
  EVIDENCE_UNAVAILABLE:
    'Inspect the evidence failure and storage availability. Do not treat missing evidence as success. When codebook_continue names a required fact the debugger could not read, the run stays paused at that stop: read nodeTest.stops and the current participants.server.continueArguments of the run resource, then call codebook_continue with those arguments to go on without it (the earlier ones now answer STALE_PAUSE), or stop the run.',
  SERVER_STOPPING:
    'Wait for the editor stop command to finish, then explicitly start and copy a new connection.',
  PREREQUISITE_MISSING:
    'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
  IDEMPOTENCY_CONFLICT:
    'Reuse a key only with identical arguments. Read the original receipt before choosing another operation.',
  UNSUPPORTED_PROFILE:
    'Use a profile returned by codebook_status. Arbitrary repository launch is not supported by this adapter.',
  LIMIT_EXCEEDED:
    'Read the named capacity limit. Stop active work before deliberately starting a fresh server instance; history files persist.',
  INVALID_REFERENCE:
    'Use the exact snapshot URI, source hash and value paths returned by the selected run.',
  INVALID_CONFIGURATION:
    'Correct the named configuration field against the selected immutable article and supported bounds before a new deliberate start. Reuse an accepted key only with identical input.',
  HISTORY_SEAL_FAILED:
    'The run is stopped and its resources are released; nothing reruns. Do not call codebook_stop again and do not claim saved learning. Tell the learner the save failed; its recorded part, when readable, opens from Saved studies. Start a new run only if the learner asks.',
  NODE_SERVER_SOURCE_REFUSED:
    "Correct the field the message names so its real path lies inside the opened repository: packageRoot a folder, entry a file inside it, and for a TypeScript entry the repository's own tsx installed by the repository's install command. Nothing was started. Start again once with a new key after the fix; the same refusal again means the prerequisite is still unmet, so tell the learner what is missing instead of retrying.",
  PLAYBACK_PROFILE_UNSUPPORTED:
    'codebook_playback controls browser recordings only. Do not start, continue or stop a run to open a test replay; ask the learner to open it.',
} as const
export type ErrorCode = keyof typeof ERROR_RECOVERY

/** Carries recoverable domain failures from {@link StudyService} to the MCP boundary. @example throw new StudyError('BUSY', 'Run is preparing') */
export class StudyError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly causeDetail = message,
  ) {
    super(message)
  }
  /** Produces a token-free error contract for clients after a tool fails. @example error.describe().recovery */
  describe() {
    return {
      code: this.code,
      message: this.message,
      cause: this.causeDetail,
      recovery: ERROR_RECOVERY[this.code],
      docs: 'codebook://help/errors',
    }
  }
}

/**
 * Marks sealed evidence whose bytes are no longer the saved ones, as distinct from evidence a newer checkpoint withdrew.
 *
 * {@link readResource} raises it for tampered or edited images and sources, and {@link readBoundedFile} for a file that
 * outgrew its limit or changed during the read; {@link captureStudy} keeps discarding a read that a concurrent state change
 * withdrew, but never this integrity failure. Clients still see `EVIDENCE_UNAVAILABLE`.
 *
 * @example throw new EvidenceIntegrityError('Captured image no longer matches its sealed hash.')
 */
export class EvidenceIntegrityError extends StudyError {
  constructor(message: string) {
    super('EVIDENCE_UNAVAILABLE', message)
  }
}

/**
 * Marks a saved study whose archive the library does not hold: it was deleted, was never saved, or has no file left to remove.
 *
 * {@link LearningLibrary.readStudy}, {@link LearningLibrary.readCheckpoint} and {@link LearningLibrary.removeStudy} raise it;
 * {@link RepositoryBookStore} tells it by its class from every other read failure, also from one that carries the same sentence.
 *
 * @example throw new StudyArchiveUnavailableError()
 */
export class StudyArchiveUnavailableError extends Error {
  constructor() {
    super(STUDY_ARCHIVE_UNAVAILABLE_MESSAGE)
  }
}

/**
 * Marks the save of a run's study whose archive and recording have both left the library since the run's recording began: another window removed the study, or its files were removed by hand. Writing the archive again would bring the study back without its recording (Cycle 0047 row 162).
 *
 * {@link LearningLibrary.saveStudy} raises it under the storage lock, before it writes anything; {@link StudyWorkspace} then forgets the study as one that left the library, as Retry storage does for a study removed by hand.
 *
 * @example throw new StudyRemovedWithItsRecordingError()
 */
export class StudyRemovedWithItsRecordingError extends Error {
  constructor() {
    super(
      "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
    )
  }
}

/**
 * Marks a saved study that a newer Codebook wrote in a format this one cannot read; the study is kept as it is and never replaced by an older file.
 *
 * {@link assertReadableStudyFormat} raises it for an archive whose `version` is too high, and {@link LearningLibrary} for a study whose newest file has a format number it does not know.
 *
 * @example throw new NewerStudyFormatError(5) // 'This study was saved in format 5 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.'
 */
export class NewerStudyFormatError extends Error {
  constructor(readonly savedFormat: number) {
    super(newerStudyFormatMessage(savedFormat))
  }
}

/**
 * Marks the refusal of a test history's start because the saved studies and the test histories together fill the Saved Study Limit; the typed signal {@link NodeTestHistoryStore.start} gives {@link StudyService}, which words the refusal for the agent through {@link fullLibraryMessage} instead of matching this text.
 *
 * @example throw new SavedStudyStorageFullError(77, 64) // taken 77 of limit 64
 */
export class SavedStudyStorageFullError extends Error {
  constructor(
    readonly taken: number,
    readonly limit: number,
  ) {
    super(
      'Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
    )
  }
}

/**
 * Marks the save of learning material whose expected revision is no longer the saved one; the typed signal {@link NodeTestHistoryStore.saveLearningMaterial} gives {@link StudyService.explainNodeHistory}, which answers `IDEMPOTENCY_CONFLICT`, so a cited path that happens to contain the words "revision changed" is never taken for it.
 *
 * @example throw new NodeLearningRevisionChangedError(0, 1)
 */
export class NodeLearningRevisionChangedError extends Error {
  constructor(expectedRevision: number, currentRevision: number) {
    super(
      `Node learning material revision changed; expected ${expectedRevision}, current ${currentRevision}.`,
    )
  }
}

/**
 * Marks a failure of the replay debugger's start (the editor refused or did not finish launching the historical session), so a test replay move can tell it from any other failure of the moment it presents; thrown by {@link ReplayDebugger}'s session wait and read by {@link StudyWorkspace}'s move failure sentence (Cycle 0052 task 17).
 * The message is the start failure's own and the name stays `Error`, so every reader of the message or the string form sees what it saw before.
 * @example throw new ReplayDebuggerStartError(new Error('The editor did not start its historical debug session.'))
 */
export class ReplayDebuggerStartError extends Error {
  constructor(cause: unknown) {
    // The name stays `Error`, so every line that shows the error's string form reads as before; only `instanceof` tells it apart.
    super(cause instanceof Error ? cause.message : String(cause), { cause })
  }
}

/** Normalizes unexpected failures without pretending they succeeded; called by {@link StudyService} where a failure becomes a run's error. The MCP answers use {@link StudyService.unexpectedFailure}, which also hides private paths in the cause. @example domainError(new Error('disk')).code */
export function domainError(error: unknown): StudyError {
  return error instanceof StudyError
    ? error
    : new StudyError(
        'RUNTIME_FAILED',
        'The study operation failed.',
        String(error),
      )
}
