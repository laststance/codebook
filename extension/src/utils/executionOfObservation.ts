import type { ConfiguredObservation } from '../configuredStudySchemas'

/**
 * Tells where the code of a saved pause ran, for the replay's pause label: a format 8 observation says so itself, an earlier one is read from its participant.
 * Called by the replay lane that labels a pause, so a study saved by 0.2.72.0 (format 7) names its server pauses as server actions, which they were.
 * @param observation - A saved observation of any study format.
 * @returns `execution` when the observation has it; else `'server-action'` for a `server` participant and `'browser'` for a `browser` one.
 * @example
 * executionOfObservation({ participant: 'server' }) // => 'server-action'
 * executionOfObservation({ participant: 'server', execution: 'server-render' }) // => 'server-render'
 */
export function executionOfObservation(
  observation: Pick<ConfiguredObservation, 'participant' | 'execution'>,
): NonNullable<ConfiguredObservation['execution']> {
  if (observation.execution) return observation.execution
  return observation.participant === 'server' ? 'server-action' : 'browser'
}
