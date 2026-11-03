import type { ConfiguredDefinition } from '../configuredStudySchemas'
import { dropDefaultPackageRoot } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { preparedInputsOf } from './preparedInputsOf'
import { redactPreparedConfiguration } from './redactPreparedConfiguration'
import type { PreparedTextState } from './redactPreparedTexts'

/**
 * Gives the configuration whose `packageRoot` is the run's canonical repository-relative folder, so every hash and saved study of one run is over one configuration (E10).
 *
 * Why it exists: a declared `packageRoot` may be a symlinked alias. The saved study keeps the real folder (or no field when the alias resolves to the repository root), so the run resource, the manifest and the learning-summary reference must hash that same form or {@link validateConfiguredStudyEvidence} rejects the saved study. Called by {@link canonicalDefinition} and {@link captureStudy}.
 * @param configuration - The (redacted) configuration of the run.
 * @param nextPackageRoot - The run view's `nextPackageRoot` (`"."` for a root alias); absent before the Next app is resolved and for a root run.
 * @returns The input itself unless it is a version 3 configuration and `nextPackageRoot` is known; otherwise the configuration with the canonical `packageRoot`, or without the field for `"."`.
 * @example
 * withCanonicalPackageRoot({ version: 3, packageRoot: 'links/web' }, 'apps/web') // => { version: 3, packageRoot: 'apps/web' }
 */
export function withCanonicalPackageRoot<
  Configuration extends ConfiguredDefinition['configuration'],
>(
  configuration: Configuration,
  nextPackageRoot: string | undefined,
): Configuration {
  // Root runs (no resolved nested folder) and older versions stay byte-identical (AC 6).
  if (nextPackageRoot === undefined || configuration.version !== 3)
    return configuration
  return dropDefaultPackageRoot({
    ...configuration,
    packageRoot: nextPackageRoot,
  })
}

/**
 * Gives the canonical redacted configuration of an accepted definition and the existing hash over it.
 *
 * Why it exists: the accepted definition holds the learner-declared prepared texts in memory; every stored, served or hashed form uses this canonical form instead (ENG-3). Called by the study service for the run resource's hash and the terminal reference, by {@link captureStudy} for the saved study and by {@link ConfiguredBrowserRun}.
 * @param definition - The accepted definition.
 * @param states - How far the run resolved each prepared text (`preparedTextStates` of its view); absent counts as nothing resolved, so every text is masked.
 * @param nextPackageRoot - The run view's canonical `nextPackageRoot` ({@link withCanonicalPackageRoot}); absent keeps the declared `packageRoot`.
 * @returns The configuration with secret and unresolved texts masked, and its SHA-256 (the definition's own hash when it has no prepared text).
 * @example
 * canonicalDefinition(definition, ['secret']).configuration.initialInputs?.[0]?.text // => '[masked]'
 */
export function canonicalDefinition(
  definition: ConfiguredDefinition,
  states: readonly (PreparedTextState | undefined)[] = [],
  nextPackageRoot?: string,
): {
  configuration: ConfiguredDefinition['configuration']
  configurationHash: string
} {
  const redacted =
    preparedInputsOf(definition.configuration) === undefined
      ? definition.configuration
      : redactPreparedConfiguration(
          definition.configuration,
          states,
          'canonical',
        )
  const configuration = withCanonicalPackageRoot(redacted, nextPackageRoot)
  // Nothing redacted or canonicalized: the definition's own hash is already over this form.
  if (configuration === definition.configuration)
    return { configuration, configurationHash: definition.configurationHash }
  return {
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
}
