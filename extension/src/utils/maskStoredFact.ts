import {
  configuredFactValueSchema,
  type ConfiguredObservation,
} from '../configuredStudySchemas'

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
  const masked = typeof fact === 'string' ? maskKnownText(fact) : fact
  return configuredFactValueSchema.safeParse(masked).success
    ? masked
    : undefined
}
