/** One prepared text of a version 1 or 2 configuration: the control's selector and the text written into it. */
export type PreparedInput = { selector: string; text: string }

/**
 * Reads a configuration's prepared texts, which only version 1 and 2 repository-browser configurations carry; a version 3 configuration has none by construction (its secrets come from the learner, DX-3).
 *
 * Why it exists: the redaction of ENG-3 applies to `initialInputs` alone, and the configuration union no longer has that field on every member. Called by {@link redactPreparedConfiguration}, {@link canonicalDefinition} and {@link ConfiguredBrowserRun}.
 * @param configuration - Any accepted configuration.
 * @returns The `initialInputs` array; `undefined` when the configuration declares none or cannot carry any.
 * @example
 * preparedInputsOf({ version: 2, initialInputs: [{ selector: '#email', text: 'a@b.c' }] }) // => [{ selector: '#email', text: 'a@b.c' }]
 * preparedInputsOf({ version: 3, operations: [] }) // => undefined
 */
export function preparedInputsOf(
  configuration: object,
): readonly PreparedInput[] | undefined {
  // Only a version 1 or 2 configuration has the field.
  if (!('initialInputs' in configuration)) return undefined
  const inputs: unknown = configuration.initialInputs
  return Array.isArray(inputs) ? inputs : undefined
}
