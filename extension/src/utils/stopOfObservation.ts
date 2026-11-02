import type { ConfiguredStudy } from '../configuredStudySchemas'

import type { configuredStops } from './configuredStops'

/**
 * Finds the declared stop an observation of a saved study belongs to: by its `declaredIndex` in format 8 (a set of server renders pauses in the order the page runs, not the declared one), by its position in format 7 and earlier.
 * Called by {@link validateConfiguredStudyEvidence} and {@link validateOperationRecords} for every observation, after {@link assertObservationFormatFields} proved that `declaredIndex` exists only where it must.
 * @param observations - The study's observations, in the order the run paused them.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @param position - The observation's position in `observations`.
 * @returns The declared stop, or `undefined` when the position or `declaredIndex` names none.
 * @example
 * stopOfObservation([{ declaredIndex: 1 }], stops, 0) // => stops[1]
 * stopOfObservation([{}], stops, 0) // => stops[0]
 */
export function stopOfObservation(
  observations: ConfiguredStudy['observations'],
  stops: ReturnType<typeof configuredStops>,
  position: number,
): ReturnType<typeof configuredStops>[number] | undefined {
  return stops[observations[position]?.declaredIndex ?? position]
}
