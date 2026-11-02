import {
  OPERATIONS_CONFIG_VERSION,
  OPERATIONS_STUDY_VERSION,
  RECORDED_LOCATION_STUDY_VERSION,
  SERVER_RENDER_STUDY_VERSION,
} from '../constants'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { afterOperationOf } from './afterOperationOf'
import { configuredStops } from './configuredStops'

/**
 * Gives the study format a new save of a sealed configuration takes: a pure function of the configuration, so the format is fixed before the first checkpoint and never changes within a run.
 * Called by {@link captureStudy} when it writes a checkpoint and by {@link validateConfiguredStudyEvidence} when it reads one; {@link legacyStudyFormatOfConfiguration} keeps the mapping of archives saved before format 6.
 * @param configuration - The sealed configuration of the run.
 * @returns
 * - {@link SERVER_RENDER_STUDY_VERSION} (8) for a version 3 configuration with any server stop, a stop with `afterOperation: 0` or no `operations`
 * - {@link OPERATIONS_STUDY_VERSION} (7) for every other version 3 configuration (browser stops only), written exactly as 0.2.72.0 writes it
 * - {@link RECORDED_LOCATION_STUDY_VERSION} (6) for versions 1 and 2
 * @example
 * studyFormatOfConfiguration({ version: 3, participant: 'browser', afterOperation: 1, operations: [op] }) // => 7
 * studyFormatOfConfiguration({ version: 3, participant: 'server', afterOperation: 0 }) // => 8
 */
export function studyFormatOfConfiguration(
  configuration: RetainedRepositoryConfiguration,
): number {
  if (configuration.version !== OPERATIONS_CONFIG_VERSION)
    return RECORDED_LOCATION_STUDY_VERSION
  // Read as possibly absent: a configuration without `operations` is a saved-session run of entry-render stops only.
  const operations: readonly unknown[] | undefined = configuration.operations
  const needsServerRenderFormat =
    operations === undefined ||
    configuredStops(configuration).some(
      (stop) => stop.participant === 'server' || afterOperationOf(stop) === 0,
    )
  return needsServerRenderFormat
    ? SERVER_RENDER_STUDY_VERSION
    : OPERATIONS_STUDY_VERSION
}
