/**
 * Tells whether a declared stop (or the configuration that holds the top-level stop) is a browser stop at the entry load.
 * @param stop - Any object; only its `participant` and `afterOperation` are read.
 * @returns `true` for `participant: "browser"` with `afterOperation: 0`.
 * @example isEntryBrowserStop({ participant: 'browser', afterOperation: 0 }) // => true
 */
function isEntryBrowserStop(stop: object): boolean {
  return (
    'participant' in stop &&
    stop.participant === 'browser' &&
    'afterOperation' in stop &&
    stop.afterOperation === 0
  )
}

/**
 * Tells whether any stop of a configuration is a browser stop at the entry load (`participant: "browser"`, `afterOperation: 0`).
 *
 * Why it exists: a run whose configuration declares one is saved as format 25 ({@link ENTRY_BROWSER_STUDY_VERSION}) so that an older Codebook lists it as saved by a newer one instead of failing on its schema; the format decision, the browser launch and the retained-schema refusals ask this one question. Called when a study's format is derived from its configuration, by the retained configuration schemas and by the run's browser launch.
 * @param configuration - Any configuration; only the participant and `afterOperation` of its top-level stop and of its `additionalStops` are read (versions 1 and 2 have no `afterOperation`).
 * @returns `true` when some stop is a browser stop declared `afterOperation: 0`.
 * @example
 * declaresEntryBrowserStop({ participant: 'browser', afterOperation: 0 }) // => true
 * declaresEntryBrowserStop({ participant: 'server', afterOperation: 0 }) // => false
 */
export function declaresEntryBrowserStop(configuration: object): boolean {
  if (isEntryBrowserStop(configuration)) return true
  return (
    'additionalStops' in configuration &&
    Array.isArray(configuration.additionalStops) &&
    configuration.additionalStops.some(
      (stop: unknown) =>
        typeof stop === 'object' && stop !== null && isEntryBrowserStop(stop),
    )
  )
}
