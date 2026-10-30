import { z } from 'zod'

import { READABLE_STUDY_VERSION } from '../constants'
import { NewerStudyFormatError } from '../errors'

/** Only the format number of an archive; every other field is left to the archive's own decoder. */
const numberedFormatSchema = z.object({ version: z.number() })

/**
 * Refuses a saved study whose `version` is above the formats this Codebook reads, before any schema is applied; called by {@link decodeConfiguredStudy} and by {@link LearningLibrary} when it reads an archive.
 * A value without a numeric `version`, or with a known or older one, passes: its own decoder judges it.
 * @param value - The parsed archive, not yet validated.
 * @throws A {@link NewerStudyFormatError} that names the saved format and the highest readable one.
 * @example
 * assertReadableStudyFormat({ version: 5 }) // passes
 * assertReadableStudyFormat({ version: 6 }) // throws 'This study was saved in format 6 by a newer Codebook; …'
 */
export function assertReadableStudyFormat(value: unknown): void {
  const format = numberedFormatSchema.safeParse(value)
  if (format.success && format.data.version > READABLE_STUDY_VERSION)
    throw new NewerStudyFormatError(format.data.version)
}
