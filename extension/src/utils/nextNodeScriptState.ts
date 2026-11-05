import type { NodeScriptView } from '../nodeScriptRuntimeTypes'

/** What ended the wait of a node-script `codebook_continue`. */
export type NextNodeScriptState =
  'paused' | 'ended' | 'learner-paused' | 'stopped' | 'failure'

/**
 * Names what the script did after a continuation was accepted, read at every turn of the wait of {@link StudyService.continueToNextState} for a node-script run.
 * @param view - The run's view at this turn; `undefined` for a run that has none.
 * @param generationBefore - The run-wide pause generation when the call began, so the pause being continued is not taken for the next one.
 * @param endings - Whether the run failed (its error, a run failure of the view, or its deadline) or is being released or was (a stop, a stopped run, a shutting-down service).
 * @returns
 * - `'failure'` once the run failed, before any other word
 * - `'ended'` once the script ended by itself or a limit (its `nodeScript.end` is set)
 * - `'stopped'` once the run is being released or was
 * - `'paused'` once the script paused at a declared stop with a pause generation newer than `generationBefore`
 * - `'learner-paused'` while the learner holds a pause
 * - `undefined` while the script is still on its way
 * @example
 * nextNodeScriptState({ ...view, end: { kind: 'exited' } }, 2, { failed: false, ended: false }) // => 'ended'
 */
export function nextNodeScriptState(
  view:
    | Pick<NodeScriptView, 'state' | 'pauseGeneration' | 'end' | 'heldPause'>
    | undefined,
  generationBefore: number,
  endings: { failed: boolean; ended: boolean },
): NextNodeScriptState | undefined {
  if (endings.failed) return 'failure'
  if (view?.end && view.end.kind !== 'stopped') return 'ended'
  if (endings.ended || view?.state === 'stopping' || view?.state === 'stopped')
    return 'stopped'
  if (view?.heldPause) return 'learner-paused'
  if (view?.state === 'paused' && view.pauseGeneration > generationBefore)
    return 'paused'
  return undefined
}
