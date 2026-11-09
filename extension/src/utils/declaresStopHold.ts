/** The part of a version 3 configuration that tells whether a stop declares a `hold`: the top-level stop and the additional stops. */
type ConfigurationWithStopHold = {
  readonly hold?: unknown
  readonly additionalStops?: readonly { readonly hold?: unknown }[]
}

/**
 * Tells whether any stop of a configuration declares `hold` (`"explain"` or `"record"`); an explicit `hold: undefined` declares nothing.
 *
 * Why it exists: a run whose configuration declares `hold` is saved as format 24 ({@link HOLD_STUDY_VERSION}) so that an older Codebook lists it as saved by a newer one instead of failing on its strict schema; the format decision and the retained-schema refusals ask this one question. Called when a study's format is derived from its configuration and by the retained configuration schemas.
 * @param configuration - Any configuration; only the `hold` of its top-level stop and of its `additionalStops` are read.
 * @returns `true` when some stop declares a `hold` that is not `undefined`.
 * @example
 * declaresStopHold({ additionalStops: [{ hold: 'record' }] }) // => true
 * declaresStopHold({ hold: undefined }) // => false
 */
export function declaresStopHold(
  configuration: ConfigurationWithStopHold,
): boolean {
  // An explicit `hold: undefined` is the same as no key: it declares nothing.
  return (
    configuration.hold !== undefined ||
    (configuration.additionalStops?.some((stop) => stop.hold !== undefined) ??
      false)
  )
}
