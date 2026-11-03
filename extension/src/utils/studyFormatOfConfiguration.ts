import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  OPERATIONS_CONFIG_VERSION,
  OPERATIONS_STUDY_VERSION,
  PACKAGE_ROOT_STUDY_VERSION,
  RECORDED_LOCATION_STUDY_VERSION,
  SERVER_RENDER_STUDY_VERSION,
} from '../constants'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { afterOperationOf } from './afterOperationOf'
import { configuredStops } from './configuredStops'

/** What the helpers here read of a saved study: its format number and its sealed configuration. */
type StudyFormatSubject = Pick<ConfiguredStudy, 'version' | 'configuration'>

/**
 * Reads the package folder a configuration declares, whatever shape holds it.
 * Called by {@link studyFormatOfConfiguration} and {@link isReadableStudyFormatOfConfiguration}; the field exists only on a version 3 configuration.
 * @param configuration - The sealed configuration.
 * @returns The `packageRoot` value, or `undefined` when the configuration carries none.
 * @example packageRootOf({ ...configuration, packageRoot: 'apps/web' }) // => 'apps/web'
 */
function packageRootOf(
  configuration: ConfiguredStudy['configuration'],
): string | undefined {
  const value: unknown = (configuration as { packageRoot?: unknown })
    .packageRoot
  return typeof value === 'string' ? value : undefined
}

/**
 * Derives the evidence rules a version 3 configuration needs: format 8 rules for any server stop, a stop with `afterOperation: 0` or no `operations`, else format 7 rules (browser-only stops).
 * Called by {@link studyFormatOfConfiguration} for a configuration without a package folder and by {@link evidenceFormatOfStudy} for a format 9 study.
 * @param configuration - A version 3 configuration.
 * @returns {@link SERVER_RENDER_STUDY_VERSION} or {@link OPERATIONS_STUDY_VERSION}.
 * @example derivedEvidenceFormat({ version: 3, participant: 'server', afterOperation: 0 }) // => 8
 */
function derivedEvidenceFormat(
  configuration: RetainedRepositoryConfiguration,
): typeof SERVER_RENDER_STUDY_VERSION | typeof OPERATIONS_STUDY_VERSION {
  // Read as possibly absent: a configuration without `operations` is a saved-session run of entry-render stops only.
  const operations: readonly unknown[] | undefined =
    configuration.version === OPERATIONS_CONFIG_VERSION
      ? configuration.operations
      : undefined
  const needsServerRenderFormat =
    operations === undefined ||
    configuredStops(configuration).some(
      (stop) => stop.participant === 'server' || afterOperationOf(stop) === 0,
    )
  return needsServerRenderFormat
    ? SERVER_RENDER_STUDY_VERSION
    : OPERATIONS_STUDY_VERSION
}

/**
 * Gives the study format a new save of a sealed configuration takes: a pure function of the configuration, so the format is fixed before the first checkpoint and never changes within a run.
 * Called by {@link captureStudy} when it writes a checkpoint and by {@link validateConfiguredStudyEvidence} when it reads one; {@link legacyStudyFormatOfConfiguration} keeps the mapping of archives saved before format 6.
 * @param configuration - The sealed configuration of the run.
 * @returns
 * - {@link PACKAGE_ROOT_STUDY_VERSION} (9) for a version 3 configuration whose `packageRoot` is a folder other than `"."`
 * - {@link SERVER_RENDER_STUDY_VERSION} (8) for a version 3 configuration with any server stop, a stop with `afterOperation: 0` or no `operations`
 * - {@link OPERATIONS_STUDY_VERSION} (7) for every other version 3 configuration (browser stops only), written exactly as 0.2.72.0 writes it
 * - {@link RECORDED_LOCATION_STUDY_VERSION} (6) for versions 1 and 2
 * @example
 * studyFormatOfConfiguration({ version: 3, participant: 'browser', afterOperation: 1, operations: [op] }) // => 7
 * studyFormatOfConfiguration({ version: 3, participant: 'server', afterOperation: 0 }) // => 8
 * studyFormatOfConfiguration({ version: 3, packageRoot: 'apps/web', participant: 'browser', afterOperation: 1, operations: [op] }) // => 9
 */
export function studyFormatOfConfiguration(
  configuration: ConfiguredStudy['configuration'],
): ConfiguredStudy['version'] {
  if (configuration.version !== OPERATIONS_CONFIG_VERSION)
    return RECORDED_LOCATION_STUDY_VERSION
  // A package folder other than the repository root makes a study no earlier Codebook can run or read.
  const packageRoot = packageRootOf(configuration)
  if (packageRoot !== undefined && packageRoot !== '.')
    return PACKAGE_ROOT_STUDY_VERSION
  return derivedEvidenceFormat(configuration)
}

/**
 * Gives the format whose evidence rules a saved study follows: its own for formats 3 to 8 (so an old format 7 study with a server stop keeps its format 7 rules), and for format 9 the rules derived from its configuration (format 7 for browser-only stops, format 8 for any server stop).
 * The one place that turns a study version into rules; every reader of `observations`, `operations` or `firstExecutionObserved` asks here instead of comparing a study version with {@link SERVER_RENDER_STUDY_VERSION} or {@link OPERATIONS_STUDY_VERSION}, which a standing test enforces.
 * @param study - The saved study, or anything with its `version` and `configuration`.
 * @returns The format number whose rules apply.
 * @example
 * evidenceFormatOfStudy({ version: 7, configuration: serverStopConfiguration }) // => 7
 * evidenceFormatOfStudy({ version: 9, configuration: serverStopConfiguration }) // => 8
 */
export function evidenceFormatOfStudy(study: StudyFormatSubject): number {
  if (
    study.version !== PACKAGE_ROOT_STUDY_VERSION ||
    study.configuration.version !== OPERATIONS_CONFIG_VERSION
  )
    return study.version
  return derivedEvidenceFormat(study.configuration)
}

/**
 * Says whether a study follows the format 8 rules: observations carry `execution`, `declaredIndex` and `executionIndex`, and an entry-render stop and `firstExecutionObserved` are allowed.
 * Called by {@link captureStudy}, {@link observationOfFormat}, {@link assertObservationFormatFields}, {@link validateConfiguredStudyEvidence} and {@link validateOperationRecords}.
 * @param study - The saved study, or anything with its `version` and `configuration`.
 * @returns `true` for format 8, and for format 9 when its configuration has a server stop, a stop at `afterOperation: 0` or no operations.
 * @example usesServerRenderEvidence({ version: 9, configuration: browserOnlyConfiguration }) // => false
 */
export function usesServerRenderEvidence(study: StudyFormatSubject): boolean {
  return evidenceFormatOfStudy(study) === SERVER_RENDER_STUDY_VERSION
}

/**
 * Says whether a saved format number is written only from a version 3 configuration (formats 7, 8 and 9), which no study of version 1 or 2 may carry.
 * Called by {@link validateConfiguredStudyEvidence} for the version 1 and 2 configurations.
 * @param version - The study's saved format.
 * @returns `true` for the formats written only from a version 3 configuration.
 * @example isOperationsStudyFormat(8) // => true
 */
export function isOperationsStudyFormat(version: number): boolean {
  return (
    version >= OPERATIONS_STUDY_VERSION && version <= PACKAGE_ROOT_STUDY_VERSION
  )
}

/**
 * Says whether a saved version 3 study's format is one a reader accepts for its configuration.
 * Why it exists: 0.2.72.0 saved every version 3 study, server stops included, as format 7, so a reader accepts format 7 for any configuration format 7 can express (`operations` present, no stop with `afterOperation: 0`); {@link studyFormatOfConfiguration} fixes only the format a new save takes. A configuration with a package folder other than `"."` is readable in format 9 only, and format 9 only for such a configuration.
 * Called by {@link validateConfiguredStudyEvidence}.
 * @param version - The study's saved format.
 * @param configuration - The study's version 3 configuration.
 * @returns `true` when the format is the one a new save takes, or format 7 for a configuration format 7 can express.
 * @example isReadableStudyFormatOfConfiguration(7, configurationWithServerActionStop) // => true
 */
export function isReadableStudyFormatOfConfiguration(
  version: number,
  configuration: ConfiguredStudy['configuration'],
): boolean {
  if (version === studyFormatOfConfiguration(configuration)) return true
  if (configuration.version !== OPERATIONS_CONFIG_VERSION) return false
  // Format 9 and a package folder belong together; format 7 below must not accept a configuration that declares one.
  if (packageRootOf(configuration) !== undefined) return false
  // Format 7 cannot hold an entry-render stop or a run without operations; its observation fields stay checked by {@link assertObservationFormatFields}.
  return (
    version === OPERATIONS_STUDY_VERSION &&
    configuration.operations !== undefined &&
    configuredStops(configuration).every((stop) => afterOperationOf(stop) !== 0)
  )
}
