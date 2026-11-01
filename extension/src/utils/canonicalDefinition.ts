import type { ConfiguredDefinition } from '../configuredStudySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { preparedInputsOf } from './preparedInputsOf'
import { redactPreparedConfiguration } from './redactPreparedConfiguration'
import type { PreparedTextState } from './redactPreparedTexts'

/**
 * Gives the canonical redacted configuration of an accepted definition and the existing hash over it.
 *
 * Why it exists: the accepted definition holds the learner-declared prepared texts in memory; every stored, served or hashed form uses this canonical form instead (ENG-3). Called by the study service for the run resource's hash and the terminal reference, by {@link captureStudy} for the saved study and by {@link ConfiguredBrowserRun}.
 * @param definition - The accepted definition.
 * @param states - How far the run resolved each prepared text (`preparedTextStates` of its view); absent counts as nothing resolved, so every text is masked.
 * @returns The configuration with secret and unresolved texts masked, and its SHA-256 (the definition's own hash when it has no prepared text).
 * @example
 * canonicalDefinition(definition, ['secret']).configuration.initialInputs?.[0]?.text // => '[masked]'
 */
export function canonicalDefinition(
  definition: ConfiguredDefinition,
  states: readonly (PreparedTextState | undefined)[] = [],
): {
  configuration: ConfiguredDefinition['configuration']
  configurationHash: string
} {
  if (preparedInputsOf(definition.configuration) === undefined)
    return {
      configuration: definition.configuration,
      configurationHash: definition.configurationHash,
    }
  const configuration = redactPreparedConfiguration(
    definition.configuration,
    states,
    'canonical',
  )
  return {
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
}
