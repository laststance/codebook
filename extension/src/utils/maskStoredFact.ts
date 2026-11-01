import {
  configuredFactValueSchema,
  type ConfiguredObservation,
} from '../configuredStudySchemas'
import { REDACTION_MASK } from '../constants'

/**
 * Masks one fact: a text by its secrets, and a number whose decimal text is itself a secret.
 *
 * Why it exists: an app may convert a digits-only learner secret with `Number(value)`, and an inspected number is not a string the text mask reaches. Only a number whose whole decimal text is masked is replaced, so protocol numbers and numbers that merely contain a secret's digits stay as they are.
 * @param fact - The fact after name and shape redaction.
 * @param maskKnownText - Masks the secrets in a text.
 * @returns The masked text, the mask for a number that equals a secret, or the fact unchanged.
 */
function maskFactValue(
  fact: ConfiguredObservation['values'][string],
  maskKnownText: (text: string) => string,
): ConfiguredObservation['values'][string] {
  if (typeof fact === 'string') return maskKnownText(fact)
  if (typeof fact !== 'number') return fact
  const decimal = String(fact)
  // The text mask replaces the whole decimal text only when it equals a secret.
  return maskKnownText(decimal) === REDACTION_MASK ? REDACTION_MASK : fact
}

/**
 * Masks the known env values in one captured fact and keeps it only while it still fits the stored bound.
 *
 * Why it exists: a mask can be longer than the value it hides, so a text near the bound could grow past it and fail the saved observation's schema. Called by {@link inspectConfiguredValues} for each available fact.
 *
 * @param fact - The fact after name and shape redaction.
 * @param maskKnownText - Masks the values a Vite run learned from its env files in a text; the identity for a run without such values.
 * @returns
 * - The fact, a text masked, when it still fits {@link configuredFactValueSchema}
 * - `undefined` when the masked text grew past the stored bound (a fact itself is never `undefined`)
 * @example
 * maskStoredFact('token abcdef', (text) => text.replaceAll('abcdef', '[masked]')) // => 'token [masked]'
 * maskStoredFact('x'.repeat(1018) + 'abcdef', (text) => text.replaceAll('abcdef', '[masked]')) // => undefined
 */
export function maskStoredFact(
  fact: ConfiguredObservation['values'][string],
  maskKnownText: (text: string) => string,
): ConfiguredObservation['values'][string] | undefined {
  const masked = maskFactValue(fact, maskKnownText)
  return configuredFactValueSchema.safeParse(masked).success
    ? masked
    : undefined
}
