import type { HistoryExclusion } from '../service'

/**
 * Sorts a run's history exclusion into the three states the service branches on, so every check of `historyExcluded` reads the same way; called by {@link StudyService}.
 * @param exclusion - The record's `historyExcluded` field.
 * @returns
 * - `'kept'`: no exclusion, the run is a checkpoint candidate
 * - `'awaiting'`: the library has not answered the admission yet
 * - `'ended'`: the run was refused at its admission or, for a test run, during its preparation (`refused-at-preparation`), a test run was stopped before its history began (`stopped-before-history`), or its study was removed (by this window's delete or outside it), so it never holds history again
 * @example
 * historyExclusionState(undefined) // => 'kept'
 * historyExclusionState('awaiting-admission') // => 'awaiting'
 * historyExclusionState('refused-at-preparation') // => 'ended'
 * historyExclusionState('stopped-before-history') // => 'ended'
 * historyExclusionState('removed-by-learner') // => 'ended'
 */
export function historyExclusionState(
  exclusion: HistoryExclusion | undefined,
): 'kept' | 'awaiting' | 'ended' {
  if (exclusion === undefined) return 'kept'
  return exclusion === 'awaiting-admission' ? 'awaiting' : 'ended'
}
