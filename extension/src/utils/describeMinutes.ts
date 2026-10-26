import { MS_PER_MINUTE } from '../constants'

/**
 * Names a duration in whole minutes, with "minute" for one and "minutes" otherwise, for the LLM Wiki run's sentences and requests.
 * Why: the notices, the confirmation and both agent requests name a run's bound; one wording keeps them from drifting apart (/ship review, Cycle 0055 pt1).
 * Trigger: {@link wikiGenerateNotice}, {@link describeWikiGenerateConfirmation}, {@link buildWikiGeneratePrompt} and {@link buildWikiUpdatePrompt}.
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
