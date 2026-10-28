import { ZodError } from 'zod'

import { StudyError } from '../errors'

/**
 * Turns a schema failure met while a server history entry is restored for a resource read into a coded, agent-ready answer, so an agent never reads a raw validation dump; any other failure is returned unchanged.
 * Called by {@link readServerHistoryResource} around the per-entry restore.
 * @param error - What the restore threw.
 * @param studyId - The history's study id, which the answer names.
 * @param baseUri - The history's resource address, which the answer points the agent back to.
 * @returns An `EVIDENCE_UNAVAILABLE` {@link StudyError} for a `ZodError` that names the history and where to read the verified events; `error` itself otherwise.
 * @example answerUnreadableHistoryEntry(new ZodError([]), 'a_b', 'codebook://node-history/a_b').code // => 'EVIDENCE_UNAVAILABLE'
 */
export function answerUnreadableHistoryEntry(
  error: unknown,
  studyId: string,
  baseUri: string,
): unknown {
  if (!(error instanceof ZodError)) return error
  const firstPath = error.issues[0]?.path.join('.') || 'an entry'
  return new StudyError(
    'EVIDENCE_UNAVAILABLE',
    `The history ${studyId} holds a stop that cannot be restored (${firstPath} is invalid). Read ${baseUri}/events for the events that verify; do not claim a saved replay for this history.`,
  )
}
