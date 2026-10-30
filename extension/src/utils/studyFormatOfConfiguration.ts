import {
  CONFIGURED_STUDY_VERSION,
  CROSS_RUNTIME_CONFIG_VERSION,
  CROSS_RUNTIME_STUDY_VERSION,
  VITE_STUDY_VERSION,
} from '../constants'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

/**
 * Gives the saved study format that a repository-browser configuration is stored in: the one place that maps configuration version and adapter to a study format.
 * Called by {@link captureStudy} when it seals a study and by {@link validateConfiguredStudyEvidence} when a reader checks that archive and intent agree.
 * A `vite-dev` study takes its own format so that an older Codebook lists it as saved by a newer one instead of failing on its schema; Next studies keep formats 3 and 4.
 * @param configuration - The sealed configuration of the study.
 * @returns 5 for a `vite-dev` configuration of either version, else 3 for a Next configuration of version 1 and 4 for version 2 (cross-runtime).
 * @example
 * studyFormatOfConfiguration({ version: 2, adapter: 'vite-dev' }) // => 5
 */
export function studyFormatOfConfiguration(
  configuration: Pick<RetainedRepositoryConfiguration, 'version' | 'adapter'>,
): number {
  // Every Vite study is format 5, cross-runtime or not, so an older Codebook refuses it as newer instead of failing the format-4 schema, which knows only Next.
  if (configuration.adapter === 'vite-dev') return VITE_STUDY_VERSION
  return configuration.version === CROSS_RUNTIME_CONFIG_VERSION
    ? CROSS_RUNTIME_STUDY_VERSION
    : CONFIGURED_STUDY_VERSION
}
