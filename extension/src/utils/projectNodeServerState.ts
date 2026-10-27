import type { NodeServerState, NodeServerView } from '../runtime'

/** What {@link projectNodeServerState} reads of the service's record of the run. */
export type NodeServerProjectionInput = {
  instanceId: string
  runId: string
  /** The run's view; `undefined` before the environment created the run. */
  view: NodeServerView | undefined
  /** The article node's item id, once the preparation pinned it. */
  itemId: string | undefined
  /** Whether the service still accepts input for the run: not stopping, not failed, not past its deadline. */
  controllable: boolean
  stopped: boolean
  /** Whether a stop is in flight, or failed and awaits its retry (D9), or the run has an error and is being released. */
  ending: boolean
}

/**
 * Says the run's state as the ten words of {@link NodeServerState}: what the run's view reports, except that a run released reads `stopped` and a run being released, or whose failed release awaits its retry (D9), or whose own failure ended it, reads `stopping`.
 * Called by {@link projectNodeServerState} and by the wait of `codebook_continue`.
 * @param view - The run's view; `undefined` before the run exists, which reads `preparing`.
 * @param stopped - Whether the run was released.
 * @param ending - Whether the release is in flight, failed or caused by the run's own failure.
 * @returns The state word.
 * @example nodeServerStateWord({ state: 'ready' }, false, false) // => 'ready'
 */
export function nodeServerStateWord(
  view: Pick<NodeServerView, 'state' | 'runFailure'> | undefined,
  stopped: boolean,
  ending: boolean,
): NodeServerState {
  if (stopped) return 'stopped'
  if (ending || view?.state === 'stopping' || view?.runFailure)
    return 'stopping'
  return view?.state ?? 'preparing'
}

/**
 * Projects a node-server run into the fields the run resource and `codebook_status` show: the state, the next actions, the server participant with the continuation arguments of a pause at a declared stop, and the `nodeServer` block with the stop, request, response and failure facts. A lost response is recovered by reading these, never by sending again.
 * Called by {@link StudyService.state} for a run of the node-server profile.
 * @param input - The service's record of the run ({@link NodeServerProjectionInput}).
 * @returns
 * - `state`: one of the ten {@link NodeServerState} words
 * - `nextActions`: `http-request` while `ready`, `continue` while paused at a declared stop, `stop` until the run is released
 * - `participant`: the server participant; `continueArguments` (`answer: 'next'`, session, thread, generation) only while paused at a declared stop and controllable
 * - `nodeServer`: address, stops, stops hit at start and reached, the pause with its capture's facts, a held pause, the request, the response, the request failure, the capture count, whether the capture budget was exhausted and the count of failed stops
 * @example
 * projectNodeServerState({ ...input, view: pausedView }).participant.continueArguments?.generation // => 3
 */
export function projectNodeServerState(input: NodeServerProjectionInput) {
  const { view } = input
  const state = nodeServerStateWord(view, input.stopped, input.ending)
  const pause = view?.pause
  const capture = pause ? view?.captures[pause.captureIndex] : undefined
  const isResumable = Boolean(input.controllable && pause && state === 'paused')
  const nextActions = [
    input.controllable && state === 'ready' ? 'http-request' : undefined,
    isResumable ? 'continue' : undefined,
    !input.stopped ? 'stop' : undefined,
  ].filter((action) => action !== undefined)
  return {
    state,
    nextActions,
    participant: {
      snapshotUri: undefined,
      sourceUri: undefined,
      itemId: input.itemId,
      actionId: undefined,
      phase: pause ? ('paused' as const) : ('running' as const),
      resumable: isResumable,
      continueArguments:
        isResumable && pause
          ? {
              instanceId: input.instanceId,
              runId: input.runId,
              participant: 'server' as const,
              sessionId: pause.sessionId,
              threadId: pause.threadId,
              generation: pause.generation,
              answer: 'next' as const,
            }
          : undefined,
    },
    nodeServer: view && {
      address: view.address,
      stops: view.stops,
      stopsHitAtStart: view.stopsHitAtStart,
      stopsReached: view.stopsReached,
      pauseGeneration: view.pauseGeneration,
      pause:
        pause && capture
          ? {
              declaredStopIndex: pause.declaredStopIndex,
              stopNumber: pause.stopNumber,
              sessionId: pause.sessionId,
              threadId: pause.threadId,
              generation: pause.generation,
              path: capture.path,
              line: capture.line,
              sourceHash: capture.sourceHash,
              facts: capture.facts,
              unavailable: capture.unavailable,
              attribution: capture.attribution,
              capturedAtMs: capture.capturedAtMs,
            }
          : undefined,
      heldPause: view.heldPause,
      request: view.request,
      response: view.response,
      requestFailure: view.requestFailure,
      captureCount: view.captures.length,
      captureBudgetExhausted: view.captureBudgetExhausted,
      failedStops: view.failedStops,
    },
  }
}
