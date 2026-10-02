import { MAX_SAVED_STUDIES } from '../constants'

/** What a full library refused: a run at its admission, a study save, or a recording reservation. */
export type FullLibraryRefusal = 'run' | 'save' | 'recording'

const FULL_LIBRARY_WORDING: Record<
  FullLibraryRefusal,
  {
    library: string
    counted: string
    removal: string
    afterwardsBelowMaximum: string
    afterwardsAtMaximum: string
    kept: string
  }
> = {
  run: {
    library: 'Study library',
    counted: 'saved studies',
    removal: 'delete a saved study from Saved studies in the Study workspace',
    afterwardsBelowMaximum: ', before starting another run',
    afterwardsAtMaximum: ' before starting another run',
    kept: 'Existing learning was kept.',
  },
  save: {
    library: 'Study library',
    counted: 'saved studies',
    removal: 'delete a saved study from Saved studies in the Study workspace',
    afterwardsBelowMaximum: ', then retry storage',
    afterwardsAtMaximum: ', then retry storage',
    kept: 'Existing learning was kept.',
  },
  recording: {
    library: 'Recording library',
    counted: 'recordings',
    removal:
      'delete a saved study that has a recording from Saved studies in the Study workspace',
    afterwardsBelowMaximum: ', before starting another session',
    afterwardsAtMaximum: ' before starting another session',
    kept: 'Existing recordings were kept.',
  },
}

/**
 * Words the refusal of a full library with a remedy that works at the current limit; called by {@link StudyService} at a run's admission, by {@link LearningLibrary.saveStudy} and by {@link RecordingStore.start}.
 * Below the maximum the setting is named first; at the maximum only a removal makes room, so the setting is not named.
 * @param refusal - Which operation the full library refused.
 * @param limit - The valid Saved Study Limit in force.
 * @returns The sentence shown to the learner and the editor agent.
 * @example
 * fullLibraryMessage('run', 64) // => 'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Existing learning was kept.'
 * fullLibraryMessage('run', 256) // => 'Study library is full at its maximum of 256 saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Existing learning was kept.'
 */
export function fullLibraryMessage(
  refusal: FullLibraryRefusal,
  limit: number,
): string {
  const wording = FULL_LIBRARY_WORDING[refusal]
  // At the maximum the setting cannot be raised, so the removal is the only remedy named.
  if (limit >= MAX_SAVED_STUDIES)
    return `${wording.library} is full at its maximum of ${MAX_SAVED_STUDIES} ${wording.counted}. ${wording.removal.charAt(0).toUpperCase()}${wording.removal.slice(1)}${wording.afterwardsAtMaximum}. ${wording.kept}`
  return `${wording.library} is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or ${wording.removal}${wording.afterwardsBelowMaximum}. ${wording.kept}`
}
