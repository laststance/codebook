import { RECORDED_LOCATION_STUDY_VERSION } from '../constants'

/**
 * Gives the saved study format that a new save of a repository-browser configuration is stored in: the one place that maps a configuration to the format a new study takes.
 * Called by {@link captureStudy} when it seals a study and by {@link validateConfiguredStudyEvidence}, which also accepts the legacy format of an older archive ({@link legacyStudyFormatOfConfiguration}).
 * Every new save is format 6, so an older Codebook lists it as saved by a newer one instead of failing on the replay frame's recorded location; the kind of study still comes from the configuration.
 * @returns Format 6, whatever the configuration.
 * @example
 * studyFormatOfConfiguration() // => 6
 */
export function studyFormatOfConfiguration(): number {
  return RECORDED_LOCATION_STUDY_VERSION
}
