import { CHROME_EXTENSION_PROFILE } from '../constants'

/**
 * Tells whether a run's record belongs to the chrome-extension profile, for the editor paths that must treat it apart from every stored run (Save refusal, no Save item).
 * Called by {@link StudyWorkspace.saveLearningReplay} and its status item.
 * @param record - The current run's record, if any; only its `profile` is read.
 * @returns `true` for a chrome-extension run, `false` for any other run or none.
 * @example hasChromeExtensionProfile({ profile: 'chrome-extension' }) // => true
 */
export function hasChromeExtensionProfile(
  record: { profile: string } | undefined,
): boolean {
  return record?.profile === CHROME_EXTENSION_PROFILE
}
