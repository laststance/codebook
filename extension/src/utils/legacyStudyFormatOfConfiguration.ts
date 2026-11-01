import {
  CONFIGURED_STUDY_VERSION,
  CROSS_RUNTIME_CONFIG_VERSION,
  CROSS_RUNTIME_STUDY_VERSION,
  OPERATIONS_CONFIG_VERSION,
  OPERATIONS_STUDY_VERSION,
  VITE_STUDY_VERSION,
} from '../constants'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

/**
 * Gives the study format an archive saved before format 6 holds for a configuration: the one place that keeps the old configuration-to-format mapping.
 * Called by {@link validateConfiguredStudyEvidence} so a v3, v4 or v5 archive still reads; new saves of versions 1 and 2 take {@link RECORDED_LOCATION_STUDY_VERSION} instead, and a save of a version 3 (operations) configuration takes {@link OPERATIONS_STUDY_VERSION}.
 * @param configuration - The sealed configuration of the study.
 * @returns 7 for an operations configuration (version 3) of any adapter, 5 for a `vite-dev` configuration of version 1 or 2, else 3 for a Next configuration of version 1 and 4 for version 2 (cross-runtime).
 * @example
 * legacyStudyFormatOfConfiguration({ version: 2, adapter: 'vite-dev' }) // => 5
 */
export function legacyStudyFormatOfConfiguration(
  configuration: Pick<RetainedRepositoryConfiguration, 'version' | 'adapter'>,
): number {
  // An operations study has its own format, whichever adapter ran it: it stores `operations[]`, which no earlier Codebook can read.
  if (configuration.version === OPERATIONS_CONFIG_VERSION)
    return OPERATIONS_STUDY_VERSION
  // Every Vite study was format 5, cross-runtime or not, because format 4's schema knows only Next.
  if (configuration.adapter === 'vite-dev') return VITE_STUDY_VERSION
  return configuration.version === CROSS_RUNTIME_CONFIG_VERSION
    ? CROSS_RUNTIME_STUDY_VERSION
    : CONFIGURED_STUDY_VERSION
}
