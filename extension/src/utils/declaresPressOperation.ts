/** The part of a version 3 configuration that tells whether it declares a press: the operations' kinds. */
type ConfigurationWithOperations = {
  readonly operations?: readonly { readonly kind: string }[]
}

/**
 * Tells whether a configuration declares at least one `press` operation.
 *
 * Why it exists: a run with a press is saved as format 21 ({@link PRESS_STUDY_VERSION}) so that an older Codebook lists it as saved by a newer one instead of failing on its schema; the format decision and the retained-schema refusal ask this one question. Called when a study's format is derived from its configuration.
 * @param configuration - A version 3 configuration, or any value with an optional `operations` list.
 * @returns `true` when some operation has `kind: 'press'`; `false` for none or no `operations`.
 * @example
 * declaresPressOperation({ operations: [{ kind: 'click' }, { kind: 'press' }] }) // => true
 * declaresPressOperation({}) // => false
 */
export function declaresPressOperation(
  configuration: ConfigurationWithOperations,
): boolean {
  return (
    configuration.operations?.some((operation) => operation.kind === 'press') ??
    false
  )
}
