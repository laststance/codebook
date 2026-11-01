import {
  redactPreparedTexts,
  type PreparedTextState,
} from './redactPreparedTexts'

/** Any declaration that may carry prepared texts: a repository-browser configuration. */
type PreparedTextHolder = {
  initialInputs?: readonly { selector: string; text: string }[]
}

/**
 * Gives a repository-browser configuration with its prepared texts redacted for one form.
 *
 * Why it exists: one canonical redacted configuration is what Codebook stores, serves and hashes; the real texts stay in the run's memory. Called by {@link ConfiguredBrowserRun} (served definition and manifest), the study service (saved study, configuration hash) and the study capture.
 * @param configuration - The accepted configuration with the learner-declared texts.
 * @param states - The state of each `initialInputs` entry by index.
 * @param form - `canonical` (stored, hashed) or `view` (run resource).
 * @returns The same configuration when it has no `initialInputs`; otherwise a copy with each text replaced.
 * @example
 * redactPreparedConfiguration(configuration, ['secret'], 'canonical').initialInputs?.[0]?.text // => '[masked]'
 */
export function redactPreparedConfiguration<T extends PreparedTextHolder>(
  configuration: T,
  states: readonly (PreparedTextState | undefined)[],
  form: 'canonical' | 'view',
): T {
  const inputs = configuration.initialInputs
  if (inputs === undefined) return configuration
  return {
    ...configuration,
    initialInputs: redactPreparedTexts(inputs, states, form),
  }
}
