/**
 * Says whether a parsed playback position file remembers the given saved study; called by {@link LearningLibrary.removeStudy} to decide whether that file moves with the study.
 * The check reads only the study identity, so a preference of another shape that still names the study moves with it.
 * @param preference - The parsed JSON of the playback position file.
 * @param studyId - The saved study that is being removed.
 * @returns Whether the preference is an object whose `studyId` is this study.
 * @example
 * playbackPreferenceNamesStudy({ version: 1, studyId: 'a_b', positionMs: 0 }, 'a_b') // => true
 * playbackPreferenceNamesStudy(null, 'a_b') // => false
 */
export function playbackPreferenceNamesStudy(
  preference: unknown,
  studyId: string,
): boolean {
  return (
    typeof preference === 'object' &&
    preference !== null &&
    'studyId' in preference &&
    preference.studyId === studyId
  )
}
