import type { RetainedStudy } from '../retainedStudySchemas'

import { declaredStopOfSnapshot } from './declaredStopOfSnapshot'
import { describeBoundPlace } from './describeBoundPlace'

/**
 * Gives the line the agent declared for an observation's stop when the debugger bound that stop on another line, so the Study pane's source label can name both lines; called by {@link projectConfiguredStudy} for a live or saved study and by {@link projectPlaybackStudy} for the stop shown at a replay's position.
 * The numbers are those of {@link describeBoundPlace}, which also words the sentence an agent reads for the same stop.
 * @param study - The study with all of its observations in commit order: a stop is found by its position among them.
 * @param observation - The observation whose source the pane shows.
 * @returns
 * - The declared line, when the stop paused on another line
 * - `undefined` when it paused on its declared line, when nothing is observed, or when no stop is declared for the observation
 * @example
 * movedStopDeclaredLine(study, study.observations[0]) // => 73 for a stop declared on line 73 that paused on line 75
 * movedStopDeclaredLine(study, study.observations[1]) // => undefined for a stop that paused where it was declared
 */
export function movedStopDeclaredLine(
  study: Pick<RetainedStudy, 'configuration' | 'observations'> | undefined,
  observation: RetainedStudy['observations'][number] | undefined,
): number | undefined {
  if (!study || !observation) return undefined
  const declared = declaredStopOfSnapshot(
    study.configuration,
    study.observations,
    observation.id,
  )
  if (!declared) return undefined
  const place = describeBoundPlace({
    declared,
    bound: { line: observation.source.line, column: observation.source.column },
  })
  return place.isMoved ? place.declaredLine : undefined
}
