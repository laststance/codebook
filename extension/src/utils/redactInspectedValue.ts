import type { ConfiguredObservation } from '../configuredStudySchemas'
import { REDACTION_MASK } from '../constants'
import type { RepositoryInspection } from '../repositoryConfigSchemas'

import { isSecretPath } from './isSecretPath'
import { redactSecretText } from './redactSecretText'
import { redactValuePreview } from './redactValuePreview'

/**
 * Applies the redaction contract to one inspected value before it is saved as a fact.
 * Why: a value under a secret-named step must never reach the chat or a saved history; called by {@link inspectConfiguredValues} for each available browser value and by {@link inspectNodeTestVariables} for each node-test display.
 * @param inspection - The declared inspection (its mode and path).
 * @param data - The captured value.
 * @returns
 * - a type inspection, `null` and `{ type }` markers: unchanged
 * - a primitive under a secret-named step: {@link REDACTION_MASK}
 * - any other string: the string with secret-named members of a preview ({@link redactValuePreview}) and credential-shaped parts ({@link redactSecretText}) masked
 * @example
 * redactInspectedValue({ path: 'form.password', mode: 'value' }, 'hunter2') // => '[masked]'
 */
export function redactInspectedValue<
  Value extends ConfiguredObservation['values'][string],
>(
  inspection: Pick<RepositoryInspection, 'mode' | 'path'>,
  data: Value,
): Value | string {
  // A type name, null and an object marker are not secret values.
  if (inspection.mode !== 'value' || data === null || typeof data === 'object')
    return data
  if (isSecretPath(inspection.path)) return REDACTION_MASK
  return typeof data === 'string'
    ? redactSecretText(redactValuePreview(data))
    : data
}
