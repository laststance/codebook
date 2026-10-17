import { STUDY_ARCHIVE_UNAVAILABLE_MESSAGE } from './constants'
import { newerStudyFormatMessage } from './utils/newerStudyFormatMessage'

export const ERROR_RECOVERY = {
  NOT_FOUND:
    'Read codebook_status and use a resource reference from the selected instance and run.',
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
    'Inspect the evidence failure and storage availability. Do not treat missing evidence as success.',
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

/** Normalizes unexpected boundary failures without pretending they succeeded; called by protocol handlers. @example domainError(new Error('disk')).code */
export function domainError(error: unknown): StudyError {
  return error instanceof StudyError
    ? error
    : new StudyError(
        'RUNTIME_FAILED',
        'The study operation failed.',
        String(error),
      )
}
