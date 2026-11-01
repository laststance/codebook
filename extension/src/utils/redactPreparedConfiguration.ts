import { preparedInputsOf } from './preparedInputsOf'
import {
  redactPreparedTexts,
  type PreparedTextState,
} from './redactPreparedTexts'

/**
 * Gives a repository-browser configuration with its prepared texts redacted for one form.
 *
 * Why it exists: one canonical redacted configuration is what Codebook stores, serves and hashes; the real texts stay in the run's memory. Called by {@link ConfiguredBrowserRun} (served definition and manifest), the study service (saved study, configuration hash) and the study capture.
 * @param configuration - The accepted configuration with the learner-declared texts.
 * @param states - The state of each `initialInputs` entry by index.
 * @param form - `canonical` (stored, hashed) or `view` (run resource).
 * @returns The same configuration when it has no `initialInputs` (none declared, or version 3); otherwise a copy with each text replaced.
 * @example
 * redactPreparedConfiguration(configuration, ['secret'], 'canonical').initialInputs?.[0]?.text // => '[masked]'
 */
export function redactPreparedConfiguration<T extends object>(
  configuration: T,
  states: readonly (PreparedTextState | undefined)[],
  form: 'canonical' | 'view',
): T {
  const inputs = preparedInputsOf(configuration)
  // A configuration without prepared texts (none declared, or version 3) is its own canonical form.
  if (inputs === undefined) return configuration
  return {
    ...configuration,
    initialInputs: redactPreparedTexts(inputs, states, form),
  }
}
