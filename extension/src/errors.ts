export const ERROR_RECOVERY = {
  NOT_FOUND: 'Read codebook_status and use a resource reference from the selected instance and run.',
  STALE_INSTANCE: 'Copy the current connection from the editor, initialize, and read codebook_status. Never replay input automatically.',
  STALE_PAUSE: 'Read the run resource and use its current continue arguments only if resumable.',
  STALE_PLAYBACK: 'Read the current playback URI and use its returned revision/study identity. Never retry by starting or continuing a run.',
  PLAYBACK_UNAVAILABLE: 'Inspect playback and the selected recording for missing/corrupt data. Leave and reopen Recording after repair; playback never retries application input.',
  BUSY: 'Read the run resource and its nextActions. Do not send another click with a new key.',
  SOURCE_CHANGED: 'Read the captured source resource. The current editor file no longer matches that capture.',
  RUNTIME_FAILED: 'Read the terminal reason and captured history. Stop owned resources; do not retry the click automatically.',
  EVIDENCE_UNAVAILABLE: 'Inspect the evidence failure and storage availability. Do not treat missing evidence as success.',
  SERVER_STOPPING: 'Wait for the editor stop command to finish, then explicitly start and copy a new connection.',
  PREREQUISITE_MISSING: 'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
  IDEMPOTENCY_CONFLICT: 'Reuse a key only with identical arguments. Read the original receipt before choosing another operation.',
  UNSUPPORTED_PROFILE: 'Use a profile returned by codebook_status. Arbitrary repository launch is not supported by this adapter.',
  LIMIT_EXCEEDED: 'Read the named capacity limit. Stop active work before deliberately starting a fresh server instance; history files persist.',
  INVALID_REFERENCE: 'Use the exact snapshot URI, source hash and value paths returned by the selected run.',
} as const;
export type ErrorCode = keyof typeof ERROR_RECOVERY;

/** Carries recoverable domain failures from {@link StudyService} to the MCP boundary. @example throw new StudyError('BUSY', 'Run is preparing') */
export class StudyError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly causeDetail = message) { super(message); }
  /** Produces a token-free error contract for clients after a tool fails. @example error.describe().recovery */
  describe() { return { code: this.code, message: this.message, cause: this.causeDetail, recovery: ERROR_RECOVERY[this.code], docs: 'codebook://help/errors' }; }
}

/** Normalizes unexpected boundary failures without pretending they succeeded; called by protocol handlers. @example domainError(new Error('disk')).code */
export function domainError(error: unknown): StudyError {
  return error instanceof StudyError ? error : new StudyError('RUNTIME_FAILED', 'The study operation failed.', String(error));
}
