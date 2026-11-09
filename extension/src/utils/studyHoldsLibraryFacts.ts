import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  NEXT_LIBRARY_STUDY_VERSION,
  OPERATIONS_CONFIG_VERSION,
  REACT_SCRIPTS_LIBRARY_STUDY_VERSION,
  STATIC_PAGE_STUDY_VERSION,
  VITE_LIBRARY_STUDY_VERSION,
} from '../constants'

/**
 * Says whether a study of a given rules version keeps the run's library facts.
 *
 * Why it exists: formats 16, 17 and 18 exist only for a run that declares `library`, while format 23 (`static-page`) holds runs with and without it, so the facts follow the sealed configuration there. Called by {@link validateConfiguredStudyEvidence} and {@link captureStudy}.
 * @param rulesVersion - The format whose rules the study follows ({@link studyRulesVersionOf}).
 * @param configuration - The study's sealed configuration.
 * @returns `true` for formats 16, 17 and 18, and for format 23 when the configuration declares `library`.
 * @example studyHoldsLibraryFacts(23, { version: 3, adapter: 'static-page', library: { packageRoot: 'packages/lib' } }) // => true
 */
export function studyHoldsLibraryFacts(
  rulesVersion: number,
  configuration: ConfiguredStudy['configuration'],
): boolean {
  if (
    rulesVersion === VITE_LIBRARY_STUDY_VERSION ||
    rulesVersion === REACT_SCRIPTS_LIBRARY_STUDY_VERSION ||
    rulesVersion === NEXT_LIBRARY_STUDY_VERSION
  )
    return true
  return (
    rulesVersion === STATIC_PAGE_STUDY_VERSION &&
    configuration.version === OPERATIONS_CONFIG_VERSION &&
    configuration.library !== undefined
  )
}
