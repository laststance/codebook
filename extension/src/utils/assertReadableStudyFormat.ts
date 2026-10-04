import { CROSS_RUNTIME_STUDY_VERSION } from '../constants'
import { NewerStudyFormatError } from '../errors'

/**
 * Refuses a saved study whose `version` is above the formats this Codebook reads, before any schema is applied; called by {@link decodeConfiguredStudy} and by {@link LearningLibrary} when it reads an archive.
 * A value without a numeric `version`, or with a known or older one, passes: its own decoder judges it.
 * @param value - The parsed archive, not yet validated.
 * @throws A {@link NewerStudyFormatError} that names the saved format and the highest readable one.
 * @example
 * assertReadableStudyFormat({ version: 4 }) // passes
 * assertReadableStudyFormat({ version: 5 }) // throws 'This study was saved in format 5 by a newer Codebook; …'
 */
export function assertReadableStudyFormat(value: unknown): void {
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    typeof value.version === 'number' &&
    value.version > CROSS_RUNTIME_STUDY_VERSION
  )
    throw new NewerStudyFormatError(value.version)
}
