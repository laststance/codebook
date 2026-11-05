import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  MODULE_EVALUATION_STUDY_VERSION,
  OPERATIONS_CONFIG_VERSION,
  OPERATIONS_STUDY_VERSION,
  PACKAGE_ROOT_STUDY_VERSION,
  REACT_SCRIPTS_STUDY_VERSION,
  RECORDED_LOCATION_STUDY_VERSION,
  SERVER_RENDER_STUDY_VERSION,
  VITE_PACKAGE_ROOT_STUDY_VERSION,
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
  // Only a version 3 configuration declares the field.
  return configuration.version === OPERATIONS_CONFIG_VERSION
    ? configuration.packageRoot
    : undefined
}

/**
 * Derives the evidence rules a version 3 configuration needs: format 8 rules for any server stop, a stop with `afterOperation: 0` or no `operations`, else format 7 rules (browser-only stops).
 * Called by {@link studyFormatOfConfiguration} for a configuration without a package folder and by {@link evidenceFormatOfStudy} for a format 9 or 10 study.
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
 * - {@link REACT_SCRIPTS_STUDY_VERSION} (11) for every version 3 `react-scripts-dev` configuration, whatever its `packageRoot` (absent, `"."` or nested)
 * - {@link VITE_PACKAGE_ROOT_STUDY_VERSION} (10) for a version 3 `vite-dev` configuration whose `packageRoot` is a folder other than `"."`
 * - {@link PACKAGE_ROOT_STUDY_VERSION} (9) for any other version 3 configuration whose `packageRoot` is a folder other than `"."`
 * - {@link SERVER_RENDER_STUDY_VERSION} (8) for a version 3 configuration with any server stop, a stop with `afterOperation: 0` or no `operations`
 * - {@link OPERATIONS_STUDY_VERSION} (7) for every other version 3 configuration (browser stops only), written exactly as 0.2.72.0 writes it
 * - {@link RECORDED_LOCATION_STUDY_VERSION} (6) for versions 1 and 2
 * @example
 * studyFormatOfConfiguration({ version: 3, participant: 'browser', afterOperation: 1, operations: [op] }) // => 7
 * studyFormatOfConfiguration({ version: 3, participant: 'server', afterOperation: 0 }) // => 8
 * studyFormatOfConfiguration({ version: 3, packageRoot: 'apps/web', participant: 'browser', afterOperation: 1, operations: [op] }) // => 9
 * studyFormatOfConfiguration({ version: 3, adapter: 'vite-dev', packageRoot: 'apps/web', participant: 'browser', afterOperation: 1, operations: [op] }) // => 10
 */
export function studyFormatOfConfiguration(
  configuration: ConfiguredStudy['configuration'],
): ConfiguredStudy['version'] {
  if (configuration.version !== OPERATIONS_CONFIG_VERSION)
    return RECORDED_LOCATION_STUDY_VERSION
  // Every react-scripts-dev run takes format 11, root or nested: an older Codebook refuses the adapter value, so it must list the study as saved by a newer Codebook.
  if (configuration.adapter === 'react-scripts-dev')
    return REACT_SCRIPTS_STUDY_VERSION
  // A package folder other than the repository root makes a study no earlier Codebook can run or read.
  const packageRoot = packageRootOf(configuration)
  if (packageRoot !== undefined && packageRoot !== '.')
    // A nested Vite app takes format 10: 0.2.77.0 cannot parse a Vite `packageRoot` inside format 9, so it would read it as unreadable instead of as saved by a newer Codebook.
    return configuration.adapter === 'vite-dev'
      ? VITE_PACKAGE_ROOT_STUDY_VERSION
      : PACKAGE_ROOT_STUDY_VERSION
  return derivedEvidenceFormat(configuration)
}

/**
 * Says whether an observation is one only format 12 can keep: a pause inside a module's evaluation (`scope: "module"`) or in Codebook's own preparation request (`attribution: "preparation"`).
 * Called by {@link studyFormatOfEvidence} when a study is written and by {@link assertObservationFormatFields} when one is read.
 * @param observation - The observation, or anything with its `scope` and `attribution`.
 * @returns `true` when the observation carries either field value.
 * @example isModuleEvaluationObservation({ scope: 'module' }) // => true
 */
export function isModuleEvaluationObservation(observation: {
  scope?: string
  attribution?: string
}): boolean {
  return (
    observation.scope === 'module' || observation.attribution === 'preparation'
  )
}

/**
 * Gives the format a save takes once its observations are known: the configuration's format ({@link studyFormatOfConfiguration}), except that a Next study (format 8 or 9) holding a module-evaluation or preparation observation takes {@link MODULE_EVALUATION_STUDY_VERSION}.
 * Called by {@link captureStudy} at every checkpoint. A study moves from 8 or 9 to 12 at the first such observation and never back, because observations are never removed; every other study keeps the format of its configuration byte for byte.
 * @param configuration - The sealed configuration of the run.
 * @param observations - The observations saved so far.
 * @returns The study format to write.
 * @example studyFormatOfEvidence(rootServerStopConfiguration, [{ scope: 'module' }]) // => 12
 */
export function studyFormatOfEvidence(
  configuration: ConfiguredStudy['configuration'],
  observations: readonly { scope?: string; attribution?: string }[],
): ConfiguredStudy['version'] {
  const format = studyFormatOfConfiguration(configuration)
  const isNextServerFormat =
    format === SERVER_RENDER_STUDY_VERSION ||
    format === PACKAGE_ROOT_STUDY_VERSION
  return isNextServerFormat && observations.some(isModuleEvaluationObservation)
    ? MODULE_EVALUATION_STUDY_VERSION
    : format
}

/**
 * Says whether a later checkpoint may carry a different format than the one before it: only the move of a Next study from format 8 or 9 to format 12, which {@link studyFormatOfEvidence} makes at its first module-evaluation or preparation observation.
 * Called by {@link assertStudyCheckpoint}; every other format change of a saved study is refused.
 * @param prior - The format of the kept checkpoint.
 * @param next - The format of the checkpoint being saved.
 * @returns `true` for 8 or 9 followed by 12.
 * @example isModuleEvaluationUpgrade(9, 12) // => true
 */
export function isModuleEvaluationUpgrade(
  prior: number,
  next: number,
): boolean {
  return (
    next === MODULE_EVALUATION_STUDY_VERSION &&
    (prior === SERVER_RENDER_STUDY_VERSION ||
      prior === PACKAGE_ROOT_STUDY_VERSION)
  )
}

/**
 * Gives the format whose evidence rules a saved study follows: its own for formats 3 to 8 (so an old format 7 study with a server stop keeps its format 7 rules), and for formats 9 and 10 the rules derived from its configuration (format 7 for browser-only stops, format 8 for any server stop).
 * The one place that turns a study version into rules; every reader of `observations`, `operations` or `firstExecutionObserved` asks here instead of comparing a study version with {@link SERVER_RENDER_STUDY_VERSION} or {@link OPERATIONS_STUDY_VERSION}, which a standing test enforces.
 * @param study - The saved study, or anything with its `version` and `configuration`.
 * @returns The format number whose rules apply.
 * @example
 * evidenceFormatOfStudy({ version: 7, configuration: serverStopConfiguration }) // => 7
 * evidenceFormatOfStudy({ version: 9, configuration: serverStopConfiguration }) // => 8
 * evidenceFormatOfStudy({ version: 10, configuration: viteBrowserStopConfiguration }) // => 7
 */
export function evidenceFormatOfStudy(study: StudyFormatSubject): number {
  if (
    (study.version !== PACKAGE_ROOT_STUDY_VERSION &&
      study.version !== VITE_PACKAGE_ROOT_STUDY_VERSION &&
      study.version !== REACT_SCRIPTS_STUDY_VERSION &&
      study.version !== MODULE_EVALUATION_STUDY_VERSION) ||
    study.configuration.version !== OPERATIONS_CONFIG_VERSION
  )
    return study.version
  return derivedEvidenceFormat(study.configuration)
}

/**
 * Says whether a study follows the format 8 rules: observations carry `execution`, `declaredIndex` and `executionIndex`, and an entry-render stop and `firstExecutionObserved` are allowed.
 * Called by {@link captureStudy}, {@link observationOfFormat}, {@link assertObservationFormatFields}, {@link validateConfiguredStudyEvidence} and {@link validateOperationRecords}.
 * @param study - The saved study, or anything with its `version` and `configuration`.
 * @returns `true` for format 8, and for formats 9 and 10 when its configuration has a server stop, a stop at `afterOperation: 0` or no operations.
 * @example usesServerRenderEvidence({ version: 9, configuration: browserOnlyConfiguration }) // => false
 */
export function usesServerRenderEvidence(study: StudyFormatSubject): boolean {
  return evidenceFormatOfStudy(study) === SERVER_RENDER_STUDY_VERSION
}

/**
 * Says whether a saved format number is written only from a version 3 configuration (formats 7 to 12), which no study of version 1 or 2 may carry.
 * Called by {@link validateConfiguredStudyEvidence} for the version 1 and 2 configurations.
 * @param version - The study's saved format.
 * @returns `true` for the formats written only from a version 3 configuration.
 * @example isOperationsStudyFormat(8) // => true
 */
export function isOperationsStudyFormat(version: number): boolean {
  return (
    version >= OPERATIONS_STUDY_VERSION &&
    version <= MODULE_EVALUATION_STUDY_VERSION
  )
}

/**
 * Says whether a saved version 3 study's format is one a reader accepts for its configuration.
 * Why it exists: 0.2.72.0 saved every version 3 study, server stops included, as format 7, so a reader accepts format 7 for any configuration format 7 can express (`operations` present, no stop with `afterOperation: 0`); {@link studyFormatOfConfiguration} fixes only the format a new save takes. A configuration with a package folder other than `"."` is readable in format 9 (Next) or 10 (Vite) only, and each of those formats only for its own adapter's configuration.
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
  // A react-scripts-dev configuration is readable as format 11 only, also without a packageRoot, so the format 7 fallback below never accepts it (DX-10).
  if (configuration.adapter === 'react-scripts-dev') return false
  // Format 12 holds a Next study with a server stop, at the repository root or in a package folder; it is what {@link studyFormatOfEvidence} gives once an observation needs it.
  if (version === MODULE_EVALUATION_STUDY_VERSION)
    return (
      configuration.adapter !== 'vite-dev' &&
      derivedEvidenceFormat(configuration) === SERVER_RENDER_STUDY_VERSION
    )
  // Formats 9 and 10 and a package folder belong together; format 7 below must not accept a configuration that declares one.
  if (packageRootOf(configuration) !== undefined) return false
  // Format 7 cannot hold an entry-render stop or a run without operations; its observation fields stay checked by {@link assertObservationFormatFields}.
  return (
    version === OPERATIONS_STUDY_VERSION &&
    configuration.operations !== undefined &&
    configuredStops(configuration).every((stop) => afterOperationOf(stop) !== 0)
  )
}
