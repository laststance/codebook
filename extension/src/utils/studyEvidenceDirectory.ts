import { join } from 'node:path'

import { studyIdSchema } from '../legacyStudySchemas'

/**
 * Names the directory that holds the raw evidence of a saved study's run (screenshots, sealed source, events), so {@link StudyWorkspace} can move it to the Trash with the study.
 * A study id is `<instanceId>_<runId>`, and the agent server writes a run's evidence to `<agentRoot>/<instanceId>/<runId>`.
 * @param agentRoot - The agent server's storage below the extension's global storage.
 * @param studyId - The saved study that is being removed.
 * @returns
 * - A study id of two identifiers: the evidence directory, which may not exist
 * - Any other text: `undefined`, so nothing outside a run directory is ever named
 * @example
 * studyEvidenceDirectory('/storage/agent', '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222')
 * // => '/storage/agent/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'
 * studyEvidenceDirectory('/storage/agent', '../elsewhere') // => undefined
 */
export function studyEvidenceDirectory(
  agentRoot: string,
  studyId: string,
): string | undefined {
  if (!studyIdSchema.safeParse(studyId).success) return undefined
  // A study id is two identifiers joined by one underscore, and neither contains one.
  return join(agentRoot, ...studyId.split('_'))
}
