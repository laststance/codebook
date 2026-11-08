import type { ConfiguredStudy } from '../configuredStudySchemas'
import {
  API_ROUTE_STUDY_VERSION,
  EXPO_WEB_API_SERVER_STUDY_VERSION,
  EXPO_WEB_STUDY_VERSION,
  MODULE_EVALUATION_STUDY_VERSION,
  OPERATIONS_CONFIG_VERSION,
  NEXT_LIBRARY_STUDY_VERSION,
  OPERATIONS_STUDY_VERSION,
  PACKAGE_ROOT_STUDY_VERSION,
  PRESS_STUDY_VERSION,
  REACT_SCRIPTS_LIBRARY_STUDY_VERSION,
  REACT_SCRIPTS_STUDY_VERSION,
  RECORDED_LOCATION_STUDY_VERSION,
  ROUTE_HANDLER_STUDY_VERSION,
  SERVER_RENDER_STUDY_VERSION,
  VITE_API_SERVER_STUDY_VERSION,
  VITE_LIBRARY_STUDY_VERSION,
  VITE_PACKAGE_ROOT_STUDY_VERSION,
} from '../constants'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

/** The version 3 shape of a retained configuration, the only one that can declare `library` or `apiServer`. */
type OperationsConfiguration = Extract<
  RetainedRepositoryConfiguration,
  { version: 3 }
>

import { afterOperationOf } from './afterOperationOf'
import { configuredStops } from './configuredStops'
import { declaresPressOperation } from './declaresPressOperation'

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
 * Says whether a study format is one of the two that hold a run's `apiServer`: format 19 (`expo-web-dev`) and format 20 (`vite-dev`).
 * The one place that names both formats; called by {@link evidenceFormatOfStudy}, {@link observationOfFormat}, {@link assertObservationFormatFields} and {@link configuredStudySchema}'s readers instead of comparing a study version with 19.
 * @param version - The study's saved format.
 * @returns `true` for 19 and 20.
 * @example isApiServerStudyFormat(20) // => true
 */
export function isApiServerStudyFormat(version: number): boolean {
  return (
    version === EXPO_WEB_API_SERVER_STUDY_VERSION ||
    version === VITE_API_SERVER_STUDY_VERSION
  )
}

/**
 * Gives the format of a run that declares `apiServer`, or `undefined` when the adapter or the declaration says otherwise.
 * Why it exists: keeps {@link studyFormatOfConfiguration} within the Fallow limits; an explicit `apiServer: undefined` declares nothing.
 * Called by {@link studyFormatOfConfiguration}.
 * @param configuration - A version 3 configuration.
 * @returns 19 for `expo-web-dev`, 20 for `vite-dev`, `undefined` for a run without `apiServer` or another adapter.
 * @example apiServerFormatOf({ adapter: 'vite-dev', apiServer }) // => 20
 */
function apiServerFormatOf(
  configuration: OperationsConfiguration,
):
  | typeof EXPO_WEB_API_SERVER_STUDY_VERSION
  | typeof VITE_API_SERVER_STUDY_VERSION
  | undefined {
  if (configuration.apiServer === undefined) return undefined
  if (configuration.adapter === 'expo-web-dev')
    return EXPO_WEB_API_SERVER_STUDY_VERSION
  return configuration.adapter === 'vite-dev'
    ? VITE_API_SERVER_STUDY_VERSION
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
 * Gives the study format a sealed configuration takes when it declares no `press` operation: the format of its other features.
 * Why it exists: format 21 ({@link PRESS_STUDY_VERSION}) keeps every fact this format keeps, so {@link studyRulesVersionOf} and {@link isReadableStudyFormatOfConfiguration} ask for it. Called by {@link studyFormatOfConfiguration} and those two; {@link legacyStudyFormatOfConfiguration} keeps the mapping of archives saved before format 6.
 * @param configuration - The sealed configuration of the run.
 * @returns
 * - {@link VITE_API_SERVER_STUDY_VERSION} (20) for a version 3 `vite-dev` configuration that declares `apiServer`
 * - {@link EXPO_WEB_API_SERVER_STUDY_VERSION} (19) for a version 3 `expo-web-dev` configuration that declares `apiServer`
 * - {@link NEXT_LIBRARY_STUDY_VERSION} (18) for a version 3 `next-dev-webpack` configuration that declares `library`
 * - {@link REACT_SCRIPTS_LIBRARY_STUDY_VERSION} (17) for a version 3 `react-scripts-dev` configuration that declares `library`
 * - {@link REACT_SCRIPTS_STUDY_VERSION} (11) for every other version 3 `react-scripts-dev` configuration, whatever its `packageRoot` (absent, `"."` or nested)
 * - {@link EXPO_WEB_STUDY_VERSION} (15) for every other version 3 `expo-web-dev` configuration, whatever its `packageRoot`
 * - {@link VITE_LIBRARY_STUDY_VERSION} (16) for a version 3 `vite-dev` configuration that declares `library`
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
function studyFormatWithoutPress(
  configuration: ConfiguredStudy['configuration'],
): ConfiguredStudy['version'] {
  if (configuration.version !== OPERATIONS_CONFIG_VERSION)
    return RECORDED_LOCATION_STUDY_VERSION
  // A next-dev-webpack run that declares `library` takes format 18: an older Codebook refuses the key, so it must list the study as saved by a newer Codebook (an explicit `library: undefined` declares nothing). Format 18 never moves to 12 to 14: it holds those fields itself.
  if (
    configuration.adapter === 'next-dev-webpack' &&
    configuration.library !== undefined
  )
    return NEXT_LIBRARY_STUDY_VERSION
  // A react-scripts-dev run that declares `library` takes format 17: an older Codebook refuses the key, so it must list the study as saved by a newer Codebook (an explicit `library: undefined` declares nothing).
  if (
    configuration.adapter === 'react-scripts-dev' &&
    configuration.library !== undefined
  )
    return REACT_SCRIPTS_LIBRARY_STUDY_VERSION
  // Every other react-scripts-dev run takes format 11, root or nested: an older Codebook refuses the adapter value, so it must list the study as saved by a newer Codebook.
  if (configuration.adapter === 'react-scripts-dev')
    return REACT_SCRIPTS_STUDY_VERSION
  // A run that declares `apiServer` takes format 19 (`expo-web-dev`) or 20 (`vite-dev`): an older Codebook refuses the key, so it must list the study as saved by a newer Codebook (an explicit `apiServer: undefined` declares nothing).
  const apiServerFormat = apiServerFormatOf(configuration)
  if (apiServerFormat !== undefined) return apiServerFormat
  // Every other expo-web-dev run takes format 15, root or nested, for the same reason.
  if (configuration.adapter === 'expo-web-dev') return EXPO_WEB_STUDY_VERSION
  // A Vite run that declares `library` takes format 16: an older Codebook refuses the key, so it must list the study as saved by a newer Codebook.
  if (
    configuration.adapter === 'vite-dev' &&
    configuration.library !== undefined
  )
    return VITE_LIBRARY_STUDY_VERSION
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
 * Gives the study format a new save of a sealed configuration takes: a pure function of the configuration, so the format is fixed before the first checkpoint and never changes within a run.
 * Called by {@link captureStudy} when it writes a checkpoint and by {@link validateConfiguredStudyEvidence} when it reads one.
 * @param configuration - The sealed configuration of the run.
 * @returns {@link PRESS_STUDY_VERSION} (21) for a version 3 configuration that declares a `press` operation, whatever else it declares; otherwise the format {@link studyFormatWithoutPress} gives (6 to 20).
 * @example
 * studyFormatOfConfiguration({ version: 3, participant: 'browser', afterOperation: 1, operations: [clickOperation] }) // => 7
 * studyFormatOfConfiguration({ version: 3, participant: 'browser', afterOperation: 1, operations: [pressOperation] }) // => 21
 */
export function studyFormatOfConfiguration(
  configuration: ConfiguredStudy['configuration'],
): ConfiguredStudy['version'] {
  // A press makes an older Codebook list the study as saved by a newer one; the facts of the underlying run stay those of studyFormatWithoutPress.
  return configuration.version === OPERATIONS_CONFIG_VERSION &&
    declaresPressOperation(configuration)
    ? PRESS_STUDY_VERSION
    : studyFormatWithoutPress(configuration)
}

/**
 * Gives the format whose configuration-derived rules a saved study follows: its own version, except that a format 21 study follows the rules of the format its configuration takes without the press.
 * Why it exists: format 21 keeps every fact the underlying run's format keeps (`apiRequest`, library facts, evidence rules); the sites that compare a study version with a specific format for such a rule ask here instead of reading `study.version`. Called by {@link evidenceFormatOfStudy}, {@link assertObservationFormatFields}, {@link observationOfFormat}, {@link captureStudy} and {@link validateConfiguredStudyEvidence}.
 * @param study - The saved study, or anything with its `version` and `configuration`.
 * @returns `study.version`, or for format 21 the format {@link studyFormatWithoutPress} gives its configuration.
 * @example
 * studyRulesVersionOf({ version: 21, configuration: viteApiServerPressConfiguration }) // => 20
 * studyRulesVersionOf({ version: 8, configuration }) // => 8
 */
export function studyRulesVersionOf(study: StudyFormatSubject): number {
  return study.version === PRESS_STUDY_VERSION
    ? studyFormatWithoutPress(study.configuration)
    : study.version
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
 * Says whether an observation is one only format 13 can keep: a pause in an App Router route handler (`execution: "route-handler"`).
 * Called by {@link studyFormatOfEvidence} when a study is written and by {@link assertObservationFormatFields} when one is read.
 * @param observation - The observation, or anything with its `execution`.
 * @returns `true` when the observation's execution is `route-handler`.
 * @example isRouteHandlerObservation({ execution: 'route-handler' }) // => true
 */
export function isRouteHandlerObservation(observation: {
  execution?: string
}): boolean {
  return observation.execution === 'route-handler'
}

/**
 * Says whether an observation is one only format 14 can keep: a pause in a Pages API route's handler (`execution: "api-route"`).
 * Called by {@link studyFormatOfEvidence} when a study is written and by {@link assertObservationFormatFields} when one is read.
 * @param observation - The observation, or anything with its `execution`.
 * @returns `true` when the observation's execution is `api-route`.
 * @example isApiRouteObservation({ execution: 'api-route' }) // => true
 */
export function isApiRouteObservation(observation: {
  execution?: string
}): boolean {
  return observation.execution === 'api-route'
}

/**
 * Gives the format a save takes once its observations are known: the configuration's format ({@link studyFormatOfConfiguration}), except that a Next study (format 8 or 9) holding an API-route observation takes {@link API_ROUTE_STUDY_VERSION}, one holding a route-handler observation takes {@link ROUTE_HANDLER_STUDY_VERSION} and one holding a module-evaluation or preparation observation takes {@link MODULE_EVALUATION_STUDY_VERSION}.
 * Called by {@link captureStudy} at every checkpoint. A study moves from 8 or 9 to 12, 13 or 14 at the first such observation, from 12 to 13 or 14 and from 13 to 14 at the first route-handler or API-route one, and never back, because observations are never removed; every other study keeps the format of its configuration byte for byte.
 * @param configuration - The sealed configuration of the run.
 * @param observations - The observations saved so far.
 * @returns The study format to write.
 * @example
 * studyFormatOfEvidence(rootServerStopConfiguration, [{ scope: 'module' }]) // => 12
 * studyFormatOfEvidence(rootServerStopConfiguration, [{ scope: 'module' }, { execution: 'route-handler' }]) // => 13
 * studyFormatOfEvidence(rootServerStopConfiguration, [{ execution: 'route-handler' }, { execution: 'api-route' }]) // => 14
 */
export function studyFormatOfEvidence(
  configuration: ConfiguredStudy['configuration'],
  observations: readonly {
    scope?: string
    attribution?: string
    execution?: string
  }[],
): ConfiguredStudy['version'] {
  const format = studyFormatOfConfiguration(configuration)
  const isNextServerFormat =
    format === SERVER_RENDER_STUDY_VERSION ||
    format === PACKAGE_ROOT_STUDY_VERSION
  if (!isNextServerFormat) return format
  // Format 14 wins: it keeps every field formats 12 and 13 keep.
  if (observations.some(isApiRouteObservation)) return API_ROUTE_STUDY_VERSION
  // Format 13 wins over 12: it keeps every field format 12 keeps.
  if (observations.some(isRouteHandlerObservation))
    return ROUTE_HANDLER_STUDY_VERSION
  return observations.some(isModuleEvaluationObservation)
    ? MODULE_EVALUATION_STUDY_VERSION
    : format
}

/**
 * Says whether a later checkpoint may carry a different format than the one before it: the move of a Next study from format 8 or 9 to format 12 ({@link studyFormatOfEvidence} makes it at the first module-evaluation or preparation observation), with the first route-handler observation the move from 8, 9 or 12 to format 13, and with the first API-route observation the move from 8, 9, 12 or 13 to format 14.
 * Called by {@link assertStudyCheckpoint}; every other format change of a saved study is refused.
 * @param prior - The format of the kept checkpoint.
 * @param next - The format of the checkpoint being saved.
 * @returns `true` for 8 or 9 followed by 12, for 8, 9 or 12 followed by 13, and for 8, 9, 12 or 13 followed by 14.
 * @example
 * isModuleEvaluationUpgrade(9, 12) // => true
 * isModuleEvaluationUpgrade(12, 13) // => true
 * isModuleEvaluationUpgrade(13, 14) // => true
 * isModuleEvaluationUpgrade(13, 12) // => false
 */
export function isModuleEvaluationUpgrade(
  prior: number,
  next: number,
): boolean {
  const isFromNextFormat =
    prior === SERVER_RENDER_STUDY_VERSION ||
    prior === PACKAGE_ROOT_STUDY_VERSION
  if (next === API_ROUTE_STUDY_VERSION)
    return (
      isFromNextFormat ||
      prior === MODULE_EVALUATION_STUDY_VERSION ||
      prior === ROUTE_HANDLER_STUDY_VERSION
    )
  if (next === ROUTE_HANDLER_STUDY_VERSION)
    return isFromNextFormat || prior === MODULE_EVALUATION_STUDY_VERSION
  return next === MODULE_EVALUATION_STUDY_VERSION && isFromNextFormat
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
  // A format 21 study follows the rules of the format its configuration takes without the press.
  const version = studyRulesVersionOf(study)
  // Formats 19 and 20 (`apiServer`) always follow the format 8 rules: their server stops carry execution, declaredIndex and executionIndex so a mixed browser and API replay keeps the order the run paused in.
  if (
    isApiServerStudyFormat(version) &&
    study.configuration.version === OPERATIONS_CONFIG_VERSION
  )
    return SERVER_RENDER_STUDY_VERSION
  if (
    (version !== PACKAGE_ROOT_STUDY_VERSION &&
      version !== VITE_PACKAGE_ROOT_STUDY_VERSION &&
      version !== REACT_SCRIPTS_STUDY_VERSION &&
      version !== MODULE_EVALUATION_STUDY_VERSION &&
      version !== ROUTE_HANDLER_STUDY_VERSION &&
      version !== API_ROUTE_STUDY_VERSION &&
      // Format 16 (`vite-dev` with `library`) follows the format 7 rules derived from its configuration, like format 10.
      version !== VITE_LIBRARY_STUDY_VERSION &&
      // Format 17 (`react-scripts-dev` with `library`) follows the format 7 rules derived from its configuration, like format 11.
      version !== REACT_SCRIPTS_LIBRARY_STUDY_VERSION &&
      // Format 18 (`next-dev-webpack` with `library`) follows the format 7 or 8 rules derived from its configuration, like format 9.
      version !== NEXT_LIBRARY_STUDY_VERSION &&
      // Format 15 (`expo-web-dev`) follows the format 7 rules derived from its configuration, like format 11.
      version !== EXPO_WEB_STUDY_VERSION) ||
    study.configuration.version !== OPERATIONS_CONFIG_VERSION
  )
    return version
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
 * Says whether a saved format number is written only from a version 3 configuration (formats 7 to 21), which no study of version 1 or 2 may carry.
 * Called by {@link validateConfiguredStudyEvidence} for the version 1 and 2 configurations.
 * @param version - The study's saved format.
 * @returns `true` for the formats written only from a version 3 configuration.
 * @example isOperationsStudyFormat(8) // => true
 */
export function isOperationsStudyFormat(version: number): boolean {
  return version >= OPERATIONS_STUDY_VERSION && version <= PRESS_STUDY_VERSION
}

/**
 * Says whether a version 3 configuration declares a key that only a format of its own keeps: `library` under `vite-dev` or `next-dev-webpack` (formats 16 and 18) or `apiServer` under `vite-dev` (format 20).
 * Why it exists: {@link isReadableStudyFormatOfConfiguration} must refuse such a configuration in every older format; one helper keeps that function within the Fallow limits. An explicit `undefined` declares nothing.
 * @param configuration - A version 3 configuration.
 * @returns `true` when the configuration declares one of those keys.
 * @example declaresFormatKeyOfItsOwn({ adapter: 'vite-dev', apiServer }) // => true
 */
function declaresFormatKeyOfItsOwn(
  configuration: OperationsConfiguration,
): boolean {
  const isViteOrNext =
    configuration.adapter === 'vite-dev' ||
    configuration.adapter === 'next-dev-webpack'
  return (
    (isViteOrNext && configuration.library !== undefined) ||
    (configuration.adapter === 'vite-dev' &&
      configuration.apiServer !== undefined)
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
  if (configuration.version !== OPERATIONS_CONFIG_VERSION)
    return version === studyFormatWithoutPress(configuration)
  // A configuration that declares a press is readable as format 21 only, and format 21 holds a configuration that declares one only.
  if (declaresPressOperation(configuration))
    return version === PRESS_STUDY_VERSION
  if (version === PRESS_STUDY_VERSION) return false
  if (version === studyFormatWithoutPress(configuration)) return true
  // A react-scripts-dev configuration is readable as format 11 (or 17 with `library`, the equality above) only, also without a packageRoot, so the format 7 fallback below never accepts it (DX-10).
  if (configuration.adapter === 'react-scripts-dev') return false
  // An expo-web-dev configuration is readable as format 15, or as 19 when it declares `apiServer` (the equality above), only.
  if (configuration.adapter === 'expo-web-dev') return false
  // A configuration that declares `library` is readable as format 16, 17 or 18 only, and a `vite-dev` one that declares `apiServer` as format 20 only (the equality above), never through the older fallbacks (formats 12 to 14 included).
  if (declaresFormatKeyOfItsOwn(configuration)) return false
  // Formats 12 to 14 hold a Next study with a server stop, at the repository root or in a package folder; they are what {@link studyFormatOfEvidence} gives once an observation needs them.
  if (
    version === MODULE_EVALUATION_STUDY_VERSION ||
    version === ROUTE_HANDLER_STUDY_VERSION ||
    version === API_ROUTE_STUDY_VERSION
  )
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
