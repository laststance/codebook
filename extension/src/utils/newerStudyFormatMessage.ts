import { READABLE_STUDY_VERSION } from '../constants'

/**
 * Words the refusal of a saved study that a newer Codebook wrote; shown as the note of its Saved studies entry, as the reason an agent reads in the library resource, and when the study is opened or read. Called by {@link NewerStudyFormatError}.
 * It names both format numbers and says that the study is kept, so the learner knows that updating the extension is the step and that nothing is lost.
 * @param savedFormat - The format number the study was saved in.
 * @returns The whole sentence.
 * @example
 * newerStudyFormatMessage(6) // => 'This study was saved in format 6 by a newer Codebook; this Codebook reads formats up to 5. Update the extension to open it. The study is kept as it is.'
 */
export function newerStudyFormatMessage(savedFormat: number): string {
  return `This study was saved in format ${savedFormat} by a newer Codebook; this Codebook reads formats up to ${READABLE_STUDY_VERSION}. Update the extension to open it. The study is kept as it is.`
}
