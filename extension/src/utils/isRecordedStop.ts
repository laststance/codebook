/**
 * Tells whether a declared stop is recorded without a hold (`hold: "record"`, API 1.43), for the run that decides after committing an observation whether to wait for `codebook_continue`.
 * Only a version 3 stop may declare `hold`; the stops of versions 1 and 2 never do and read `false`.
 * @param stop - A stop as {@link configuredStops} gives it.
 * @returns `true` for a stop that declares `hold: "record"`; `false` for `hold: "explain"`, an absent field and every stop of versions 1 and 2.
 * @example
 * isRecordedStop({ hold: 'record' }) // => true
 * isRecordedStop({ participant: 'browser' }) // => false
 */
export function isRecordedStop(stop: object): boolean {
  return 'hold' in stop && stop.hold === 'record'
}
