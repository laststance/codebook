import { MAX_SAVED_STUDIES } from '../constants'

import { systemTrashName } from './systemTrashName'

/** What a full library refused: a run at its admission, a study save, or a recording reservation. */
export type FullLibraryRefusal = 'run' | 'save' | 'recording'

/**
 * Whether this window can remove a saved study, as {@link StudyService} holds it for the session.
 * - `available`: the Trash refused no move in this session, or a later removal moved its study to the Trash.
 * - `trash-refused`: the Trash refused a move in this session, and no removal moved its study since.
 * - `no-trash`: the window has no Trash (a WSL remote window); no removal is started there.
 */
export type StudyRemovalAvailability =
  'available' | 'trash-refused' | 'no-trash'

const SETTING = 'Codebook: Saved Study Limit (codebook.savedStudyLimit)',
  TRASH = systemTrashName()

/** Each refusal's sentences, held whole, for each removal availability: below the maximum, where the setting can be raised, and at the maximum. */
const FULL_LIBRARY_SENTENCES: Record<
  FullLibraryRefusal,
  Record<StudyRemovalAvailability, { belowMaximum: string; atMaximum: string }>
> = {
  run: {
    available: {
      belowMaximum: `Study library is full. Increase ${SETTING} in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.`,
      atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Only the learner can delete a saved study; an editor agent cannot. Existing learning was kept.`,
    },
    'trash-refused': {
      belowMaximum: `Study library is full. Increase ${SETTING} in Settings before starting another run; this editor could not move a saved study to the ${TRASH} in this session. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.`,
      atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies, and this editor could not move a saved study to the ${TRASH} in this session, so no saved study can be deleted here. Existing learning was kept.`,
    },
    'no-trash': {
      belowMaximum: `Study library is full. Increase ${SETTING} in Settings before starting another run; this window has no Trash, so Codebook cannot delete a saved study here. Only the learner can change the setting; an editor agent cannot. Existing learning was kept.`,
      atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies, and this window has no Trash, so Codebook cannot delete a saved study here. Only the learner can make room: choose a study in Saved studies and open Remove by hand to list its files, then remove them by hand; an editor agent never deletes files. Existing learning was kept.`,
    },
  },
  save: {
    available: {
      belowMaximum: `Study library is full. Increase ${SETTING} in Settings, or delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.`,
      atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies. Delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.`,
    },
    'trash-refused': {
      belowMaximum: `Study library is full. Increase ${SETTING} in Settings, then retry storage; this editor could not move a saved study to the ${TRASH} in this session. Existing learning was kept.`,
      atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies, and this editor could not move a saved study to the ${TRASH} in this session, so no saved study can be deleted here. Existing learning was kept.`,
    },
    'no-trash': {
      belowMaximum: `Study library is full. Increase ${SETTING} in Settings, then retry storage; this window has no Trash, so Codebook cannot delete a saved study here. Existing learning was kept.`,
      atMaximum: `Study library is full at its maximum of ${MAX_SAVED_STUDIES} saved studies, and this window has no Trash, so Codebook cannot delete a saved study here. Choose a study in Saved studies and open Remove by hand to list its files; remove them, then retry storage. Existing learning was kept.`,
    },
  },
  recording: {
    available: {
      belowMaximum: `Recording library is full. Increase ${SETTING} in Settings, or delete a saved study that has a recording from Saved studies in the Study workspace, before starting another session. Existing recordings were kept.`,
      atMaximum: `Recording library is full at its maximum of ${MAX_SAVED_STUDIES} recordings. Delete a saved study that has a recording from Saved studies in the Study workspace before starting another session. Existing recordings were kept.`,
    },
    'trash-refused': {
      belowMaximum: `Recording library is full. Increase ${SETTING} in Settings before starting another session; this editor could not move a saved study to the ${TRASH} in this session. Existing recordings were kept.`,
      atMaximum: `Recording library is full at its maximum of ${MAX_SAVED_STUDIES} recordings, and this editor could not move a saved study to the ${TRASH} in this session, so no recording can be deleted here. Existing recordings were kept.`,
    },
    'no-trash': {
      belowMaximum: `Recording library is full. Increase ${SETTING} in Settings before starting another session; this window has no Trash, so Codebook cannot delete a saved study here. Existing recordings were kept.`,
      atMaximum: `Recording library is full at its maximum of ${MAX_SAVED_STUDIES} recordings, and this window has no Trash, so Codebook cannot delete a saved study here. Choose a study that has a recording in Saved studies and open Remove by hand to list its files; remove them before starting another session. Existing recordings were kept.`,
    },
  },
}

/**
 * Words the refusal of a full library with a remedy that works at the current limit; called by {@link StudyService} at a run's admission, by {@link LearningLibrary.saveStudy} and by {@link RecordingStore.start}.
 * Below the maximum the setting is named first; at the maximum only a removal makes room, so the setting is not named. A run refusal, which an editor agent receives, says that only the learner can apply the remedy. In a window without a Trash the sentences say so and, at the maximum, name the removal by hand: the files of a study are listed once the learner has chosen it in Saved studies and opened Remove by hand.
 * @param refusal - Which operation the full library refused.
 * @param limit - The valid Saved Study Limit in force.
 * @param removal - Whether this window can remove a saved study; the delete remedy is named only while it is `available`, and a window without a Trash is told apart from a Trash that refused.
 * @returns The sentence shown to the learner and the editor agent.
 * @example
 * fullLibraryMessage('run', 64) // => 'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.'
 * fullLibraryMessage('save', 64, 'no-trash') // => 'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, then retry storage; this window has no Trash, so Codebook cannot delete a saved study here. Existing learning was kept.'
 * fullLibraryMessage('run', 256, 'trash-refused') // => 'Study library is full at its maximum of 256 saved studies, and this editor could not move a saved study to the Trash in this session, so no saved study can be deleted here. Existing learning was kept.'
 */
export function fullLibraryMessage(
  refusal: FullLibraryRefusal,
  limit: number,
  removal: StudyRemovalAvailability = 'available',
): string {
  const sentences = FULL_LIBRARY_SENTENCES[refusal][removal]
  // At the maximum the setting cannot be raised, so it is not named.
  return limit >= MAX_SAVED_STUDIES
    ? sentences.atMaximum
    : sentences.belowMaximum
}
