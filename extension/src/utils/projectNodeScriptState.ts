import type { NodeScriptState, NodeScriptView } from '../nodeScriptRuntimeTypes'

import {
  currentNodePause,
  nodeContinueArguments,
  projectNodePause,
} from './projectNodePause'

/** What {@link projectNodeScriptState} reads of the service's record of the run. */
export type NodeScriptProjectionInput = {
  instanceId: string
  runId: string
  /** The run's view; `undefined` before the environment created the run. */
  view: NodeScriptView | undefined
  /** The article node's item id, once the preparation pinned it. */
  itemId: string | undefined
  /** Whether the service still accepts input for the run: not stopping, not failed, not past its deadline. */
  controllable: boolean
  stopped: boolean
  /** Whether a stop is in flight, or failed and awaits its retry, or the run has an error and is being released. */
  ending: boolean
  /** Replaces the private roots of a text a debugger or the script wrote. */
  sanitize: (text: string) => string
}

/**
 * Says the run's state as the eight words of {@link NodeScriptState}: what the run's view reports, except that a released run reads `stopped` (or `ended` when the script ended by itself or a limit) and a run being released, or whose own failure ended it, reads `stopping`.
 * @param view - The run's view; `undefined` before the run exists, which reads `preparing`.
 * @param stopped - Whether the run was released.
 * @param ending - Whether the release is in flight, failed or caused by the run's own failure.
 * @returns The state word.
 * @example nodeScriptStateWord({ state: 'running' }, false, false) // => 'running'
 */
function nodeScriptStateWord(
  view: Pick<NodeScriptView, 'state' | 'runFailure' | 'end'> | undefined,
  stopped: boolean,
  ending: boolean,
): NodeScriptState {
  if (stopped)
    return view?.end && view.end.kind !== 'stopped' ? 'ended' : 'stopped'
  if (ending || view?.state === 'stopping' || view?.runFailure)
    return 'stopping'
  return view?.state ?? 'preparing'
}

/**
 * Projects a node-script run into the fields the run resource and `codebook_status` show: the state, the next actions, the server participant with the continuation arguments of a pause at a declared stop, and the `nodeScript` block with the confirmation, the pause, the end and the stops.
 * Called by {@link StudyService.state} for a run of the node-script profile.
 * @param input - The service's record of the run ({@link NodeScriptProjectionInput}).
 * @returns
 * - `state`: one of the eight {@link NodeScriptState} words
 * - `nextActions`: `continue-server` while paused at a declared stop, `stop` until the run is released
 * - `participant`: the participant the continuation names; `continueArguments` only while paused at a declared stop and controllable
 * - `nodeScript`: `state`, `confirmation`, the stops and those reached, the pause with its capture's facts, a held pause, the end, the capture count, `continueArguments` and, by run, the `library` facts or the `repositoryPackageCopies`
 * @example
 * projectNodeScriptState({ ...input, view: pausedView }).participant.continueArguments?.generation // => 3
 */
export function projectNodeScriptState(input: NodeScriptProjectionInput) {
  const { view } = input
  const state = nodeScriptStateWord(view, input.stopped, input.ending)
  const { pause, capture, isResumable } = currentNodePause(
    view,
    state,
    input.controllable,
  )
  const continueArguments = nodeContinueArguments(input, pause, isResumable)
  return {
    state,
    nextActions: [
      isResumable ? 'continue-server' : undefined,
      !input.stopped ? 'stop' : undefined,
    ].filter((action) => action !== undefined),
    participant: {
      snapshotUri: undefined,
      sourceUri: undefined,
      itemId: input.itemId,
      actionId: undefined,
      phase: pause ? ('paused' as const) : ('running' as const),
      resumable: isResumable,
      continueArguments,
    },
    nodeScript: view && {
      state,
      confirmation: view.confirmation,
      stops: view.stops,
      stopsReached: view.stopsReached,
      pauseGeneration: view.pauseGeneration,
      pause: projectNodePause(pause, capture),
      heldPause: view.heldPause && {
        ...view.heldPause,
        reason: input.sanitize(view.heldPause.reason),
      },
      continueArguments,
      end: view.end,
      captureCount: view.captures.length,
      captureBudgetExhausted: view.captureBudgetExhausted,
      failedStops: view.failedStops,
      // A run with `library` reports its facts and observation; the first other copy's path hides the private roots.
      ...(view.library
        ? {
            library: {
              ...view.library,
              ...(view.library.publishedCopyPath === undefined
                ? {}
                : {
                    publishedCopyPath: input.sanitize(
                      view.library.publishedCopyPath,
                    ),
                  }),
            },
          }
        : {}),
      // A run without `library` lists the installed copies of the repository's own packages, correspondence unverified.
      ...(view.repositoryPackageCopies
        ? { repositoryPackageCopies: view.repositoryPackageCopies }
        : {}),
    },
  }
}
