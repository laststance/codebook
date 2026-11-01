import type { ChromeExtensionConfiguration } from '../chromeExtensionConfigSchemas'

import {
  redactPreparedTexts,
  type PreparedTextState,
} from './redactPreparedTexts'

/**
 * Gives a Chrome extension declaration with each click's input texts redacted for one form.
 *
 * Why it exists: an extension click's `inputs` are served in the manifest resource, so a password typed there needs the same masking as a repository-browser prepared text. Called by the study service for the manifest resource and the configuration hash.
 * @param configuration - The validated declaration with the learner-declared texts.
 * @param states - The state of each click's inputs by click then input (zero-based), as the run's view reports.
 * @param form - `canonical` (hashed; every text not known plain is masked) or `view` (manifest resource; `[pending]` until typed).
 * @returns A copy with each input text replaced; clicks without inputs are unchanged.
 * @example
 * redactExtensionInputs(configuration, [['secret']], 'view').clicks[0]?.inputs?.[0]?.text // => '[masked]'
 */
export function redactExtensionInputs(
  configuration: ChromeExtensionConfiguration,
  states: readonly (readonly (PreparedTextState | undefined)[])[],
  form: 'canonical' | 'view',
): ChromeExtensionConfiguration {
  return {
    ...configuration,
    clicks: configuration.clicks.map((click, clickIndex) =>
      click.inputs === undefined
        ? click
        : {
            ...click,
            inputs: redactPreparedTexts(
              click.inputs,
              states[clickIndex] ?? [],
              form,
            ),
          },
    ),
  }
}
