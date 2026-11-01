import { MS_PER_MINUTE } from '../constants'

/**
 * Names a duration in whole minutes, with "minute" for one and "minutes" otherwise, for the LLM Wiki run's sentences and requests and the saved-session help.
 * Why: the notices, the confirmation, both agent requests and the help name a bound read from its constant; one wording keeps them from drifting apart (/ship review, Cycle 0055 pt1).
 * Trigger: {@link wikiGenerateNotice}, {@link describeWikiGenerateConfirmation}, {@link buildWikiGeneratePrompt}, {@link buildWikiUpdatePrompt} and {@link savedSessionHelp} (the setup's bound).
 * @param durationMs - The duration in milliseconds; it is rounded to the nearest whole minute.
 * @returns The count and its noun.
 * @example
 * describeMinutes(3_300_000) // => '55 minutes'
 * describeMinutes(60_000)    // => '1 minute'
 */
export function describeMinutes(durationMs: number): string {
  const minutes = Math.round(durationMs / MS_PER_MINUTE)
  // One minute takes the singular; every other count, zero included, the plural.
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}
