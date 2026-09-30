import { DEFAULT_SAVED_STUDY_LIMIT, MAX_SAVED_STUDIES } from '../constants'

/** Validates the current setting when library/store admission runs; reads and existing checkpoints stay available. @example savedStudyLimit(undefined) // 64 */
export function savedStudyLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SAVED_STUDY_LIMIT
  // Invalid settings cannot silently enlarge storage or prevent reading previously saved learning.
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_SAVED_STUDIES
  ) {
    throw new Error(
      `Set Codebook: Saved Study Limit (codebook.savedStudyLimit) to an integer from 1 to ${MAX_SAVED_STUDIES}. Existing learning was kept.`,
    )
  }
  return value
}
