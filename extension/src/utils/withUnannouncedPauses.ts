import { withFinalPeriod } from './withFinalPeriod'

/** One participant that is paused with no announced debugger stop, and where. */
export interface UnannouncedPausePlace {
  participant: string
  /** The place as {@link pausePlace} names it. */
  place: string
}

/**
 * Adds to a deadline's failure text where each participant is still paused without a debugger stop, so the editor agent learns why nothing progressed.
 * Called by {@link ConfiguredBrowserRun} at the moment a progress deadline expires; the pause that explains the expiry arrives after the deadline's text was chosen.
 * @param reason - The deadline's own text; none of them ends with a period.
 * @param pauses - The participants that hold a pause no debugger stop announced, in the order to name them.
 * @returns
 * - With no such pause: the reason unchanged
 * - Otherwise: the reason, a period, and one sentence per participant
 * @example
 * withUnannouncedPauses('Repository input reached no verified pause', [{ participant: 'server', place: 'auth.ts:18' }])
 * // => 'Repository input reached no verified pause. The server is paused at auth.ts:18 without a debugger stop.'
 * withUnannouncedPauses('Repository input reached no verified pause', []) // => 'Repository input reached no verified pause'
 */
export function withUnannouncedPauses(
  reason: string,
  pauses: readonly UnannouncedPausePlace[],
): string {
  return pauses.reduce(
    (text, pause) =>
      `${withFinalPeriod(text)} The ${pause.participant} is paused at ${pause.place} without a debugger stop.`,
    reason,
  )
}
