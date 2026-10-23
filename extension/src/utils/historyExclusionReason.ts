import type { HistoryExclusion } from '../service'

import { systemTrashName, type SystemTrashName } from './systemTrashName'

/**
 * Says why a retained run has no saved history, for the run resource an editor agent reads; called by {@link StudyService.state} for a record whose history is excluded and by {@link StudyService.assertEvidenceAvailable} for a removed run's evidence.
 * @param exclusion - The record's exclusion, if any.
 * @param trashName - The host's word for the system Trash.
 * @returns
 * - Refused at the admission: the refusal sentence
 * - A test run refused during its preparation: the sentence that points to the run's error
 * - A test run stopped before its history began: the sentence that says nothing was recorded
 * - Removed by the learner with this window's delete: the removal sentence with the host's Trash word
 * - The archive left the library without such a removal (files removed by hand, or by another window): the sentence that names the archive and both ways; it names no Trash, which a window that lists files for removal by hand does not have
 * - Awaiting its admission, or not excluded: `undefined`
 * @example
 * historyExclusionReason('refused-at-admission') // => 'The run was refused before it started; nothing was saved.'
 * historyExclusionReason('removed-by-learner', 'Trash') // => 'The learner moved this saved study to the Trash.'
 * historyExclusionReason('archive-removed') // => "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window."
 */
export function historyExclusionReason(
  exclusion: Exclude<HistoryExclusion, 'awaiting-admission'>,
  trashName?: SystemTrashName,
): string
export function historyExclusionReason(
  exclusion: HistoryExclusion | undefined,
  trashName?: SystemTrashName,
): string | undefined
export function historyExclusionReason(
  exclusion: HistoryExclusion | undefined,
  trashName: SystemTrashName = systemTrashName(),
): string | undefined {
  if (exclusion === 'refused-at-admission')
    return 'The run was refused before it started; nothing was saved.'
  if (exclusion === 'refused-at-preparation')
    return "The test run was refused during its preparation, before its history began; nothing was recorded. Read the run's error for the fix."
  if (exclusion === 'stopped-before-history')
    return 'The test run ended before its history began; nothing was recorded.'
  if (exclusion === 'removed-by-learner')
    return `The learner moved this saved study to the ${trashName}.`
  if (exclusion === 'archive-removed')
    return "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window."
  return undefined
}
