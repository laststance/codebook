import type { HistoryExclusion } from '../service'

import { systemTrashName, type SystemTrashName } from './systemTrashName'

/**
 * Says why a retained run has no saved history, for the run resource an editor agent reads; called by {@link StudyService.state} for a record whose history is excluded.
 * @param exclusion - The record's exclusion, if any.
 * @param trashName - The host's word for the system Trash.
 * @returns
 * - Refused at the admission: the refusal sentence
 * - Removed by the learner: the removal sentence with the host's Trash word
 * - Awaiting its admission, or not excluded: `undefined`
 * @example
 * historyExclusionReason('refused-at-admission') // => 'The run was refused before it started; nothing was saved.'
 * historyExclusionReason('removed-by-learner', 'Trash') // => 'The learner moved this saved study to the Trash.'
 */
export function historyExclusionReason(
  exclusion: HistoryExclusion | undefined,
  trashName: SystemTrashName = systemTrashName(),
): string | undefined {
  if (exclusion === 'refused-at-admission')
    return 'The run was refused before it started; nothing was saved.'
  if (exclusion === 'removed-by-learner')
    return `The learner moved this saved study to the ${trashName}.`
  return undefined
}
