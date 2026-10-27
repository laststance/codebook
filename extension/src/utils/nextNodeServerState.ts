import type { NodeServerView } from '../runtime'

/** What ended the wait of a node-server `codebook_continue`. */
export type NextNodeServerState =
  | 'paused'
  | 'responded'
  | 'request-failed'
  | 'learner-paused'
  | 'unattributed'
  | 'stopped'
  | 'failure'

/**
 * Names what the request did after a continuation was accepted, read at every turn of the wait of {@link StudyService.continueToNextState} for a node-server run.
 * @param view - The run's view at this turn; `undefined` for a run that has none.
 * @param generationBefore - The run-wide pause generation when the call began, so the pause being continued is not taken for the next one.
 * @param endings - Whether the run failed (`failed`: its error or a run failure of the view, also its deadline) or is being released or was (`ended`: a stop, a stopped run, a shutting-down service).
 * @returns
 * - `'failure'` once the run failed, before any other word
 * - `'stopped'` once the run is being released or was (a stop during the wait answers it)
 * - `'paused'` once the request paused at a declared stop with a pause generation newer than `generationBefore`
 * - `'responded'`, `'request-failed'`, `'learner-paused'` or `'unattributed'` for the view's state of that name
 * - `undefined` while the request is still on its way (`request-in-flight`, or the old pause not yet resumed)
 * @example
 * nextNodeServerState({ ...view, state: 'responded' }, 2, { failed: false, ended: false }) // => 'responded'
 */
export function nextNodeServerState(
  view: Pick<NodeServerView, 'state' | 'pauseGeneration'> | undefined,
  generationBefore: number,
  endings: { failed: boolean; ended: boolean },
): NextNodeServerState | undefined {
  if (endings.failed) return 'failure'
  if (endings.ended || view?.state === 'stopping' || view?.state === 'stopped')
    return 'stopped'
  if (view?.state === 'paused')
    return view.pauseGeneration > generationBefore ? 'paused' : undefined
  if (
    view?.state === 'responded' ||
    view?.state === 'request-failed' ||
    view?.state === 'learner-paused' ||
    view?.state === 'unattributed'
  )
    return view.state
  return undefined
}
