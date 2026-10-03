import { MAX_SAVED_STUDIES } from '../constants'

import { systemTrashName } from './systemTrashName'

/** What a full library refused: a run at its admission, a study save, or a recording reservation. */
export type FullLibraryRefusal = 'run' | 'save' | 'recording'

const SETTING = 'Codebook: Saved Study Limit (codebook.savedStudyLimit)',
  TRASH = systemTrashName()

/** Each refusal's sentences, held whole: below the maximum, at the maximum, and both for an editor whose Trash refused a removal in this session. */
const FULL_LIBRARY_SENTENCES: Record<
  FullLibraryRefusal,
  {
    belowMaximum: string
    atMaximum: string
    belowMaximumWithoutRemoval: string
    atMaximumWithoutRemoval: string
  }
> = {
  run: {
    belowMaximum: `Study library is full. Increase ${SETTING} in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.`,
    atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Only the learner can delete a saved study; an editor agent cannot. Existing learning was kept.`,
    belowMaximumWithoutRemoval: `Study library is full. Increase ${SETTING} in Settings before starting another run; this editor could not move a saved study to the ${TRASH} in this session. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.`,
    atMaximumWithoutRemoval: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies, and this editor could not move a saved study to the ${TRASH} in this session, so no saved study can be deleted here. Existing learning was kept.`,
  },
  save: {
    belowMaximum: `Study library is full. Increase ${SETTING} in Settings, or delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.`,
    atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies. Delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.`,
    belowMaximumWithoutRemoval: `Study library is full. Increase ${SETTING} in Settings, then retry storage; this editor could not move a saved study to the ${TRASH} in this session. Existing learning was kept.`,
    atMaximumWithoutRemoval: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies, and this editor could not move a saved study to the ${TRASH} in this session, so no saved study can be deleted here. Existing learning was kept.`,
  },
  recording: {
    belowMaximum: `Recording library is full. Increase ${SETTING} in Settings, or delete a saved study that has a recording from Saved studies in the Study workspace, before starting another session. Existing recordings were kept.`,
    atMaximum: `Recording library is full at its maximum of ${MAX_SAVED_STUDIES} recordings. Delete a saved study that has a recording from Saved studies in the Study workspace before starting another session. Existing recordings were kept.`,
    belowMaximumWithoutRemoval: `Recording library is full. Increase ${SETTING} in Settings before starting another session; this editor could not move a saved study to the ${TRASH} in this session. Existing recordings were kept.`,
    atMaximumWithoutRemoval: `Recording library is full at its maximum of ${MAX_SAVED_STUDIES} recordings, and this editor could not move a saved study to the ${TRASH} in this session, so no recording can be deleted here. Existing recordings were kept.`,
  },
}

/**
 * Words the refusal of a full library with a remedy that works at the current limit; called by {@link StudyService} at a run's admission, by {@link LearningLibrary.saveStudy} and by {@link RecordingStore.start}.
 * Below the maximum the setting is named first; at the maximum only a removal makes room, so the setting is not named. A run refusal, which an editor agent receives, says that only the learner can apply the remedy.
 * @param refusal - Which operation the full library refused.
 * @param limit - The valid Saved Study Limit in force.
 * @param isRemovalAvailable - `false` once this editor's Trash refused a removal in this session; the delete remedy is then not named.
 * @returns The sentence shown to the learner and the editor agent.
 * @example
 * fullLibraryMessage('run', 64) // => 'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.'
 * fullLibraryMessage('run', 256, false) // => 'Study library is full at its maximum of 256 saved studies, and this editor could not move a saved study to the Trash in this session, so no saved study can be deleted here. Existing learning was kept.'
 */
export function fullLibraryMessage(
  refusal: FullLibraryRefusal,
  limit: number,
  isRemovalAvailable = true,
): string {
  const sentences = FULL_LIBRARY_SENTENCES[refusal]
  // At the maximum the setting cannot be raised, so the removal is the only remedy named.
  if (limit >= MAX_SAVED_STUDIES)
    return isRemovalAvailable
      ? sentences.atMaximum
      : sentences.atMaximumWithoutRemoval
  return isRemovalAvailable
    ? sentences.belowMaximum
    : sentences.belowMaximumWithoutRemoval
}
