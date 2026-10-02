import type { LearnerProgress } from '../learnerSchemas'

import { withoutStudy } from './withoutStudy'

/** Keeps what the learner was reading and drops only the selection's reference to a removed study. @example selectionWithoutStudy({ studyId: 'a_b', itemId: 'x' }, 'a_b') // => { itemId: 'x' } */
function selectionWithoutStudy(
  selection: LearnerProgress['selection'],
  studyId: string,
) {
  if (selection?.studyId !== studyId) return selection
  const { studyId: _removedStudyId, ...readingPosition } = selection
  return readingPosition
}

/**
 * Drops the learner ledger's two navigation references to a saved study that is being removed; called by {@link LearningLibrary.removeStudy} before the ledger is rewritten.
 * Learner decisions name no study and are returned unchanged, as are the selection's other fields.
 * @param progress - The ledger as it was read.
 * @param studyId - The saved study that is being removed.
 * @returns
 * - the ledger without `selection.studyId` and with `repositoryReturn` undefined, each only when it names the study (an undefined field is not written)
 * - `undefined` when neither names the study, so the ledger file is left untouched
 * @example
 * withoutStudyReferences({ ...ledger, selection: { studyId: 'a_b', itemId: 'x' } }, 'a_b') // => { ...ledger, selection: { itemId: 'x' } }
 * withoutStudyReferences(ledger, 'another_study') // => undefined
 */
export function withoutStudyReferences(
  progress: LearnerProgress,
  studyId: string,
) {
  const selection = selectionWithoutStudy(progress.selection, studyId),
    repositoryReturn = withoutStudy(progress.repositoryReturn, studyId)
  if (
    selection === progress.selection &&
    repositoryReturn === progress.repositoryReturn
  )
    return undefined
  return { ...progress, selection, repositoryReturn }
}
