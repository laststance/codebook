import type { NodeServerCapture, NodeServerPause } from '../runtime'

/**
 * Projects the current pause of a node run (server or script) into the run resource's `pause`: the stop, the identity a continuation copies and the captured facts.
 * Called by {@link projectNodeServerState} and {@link projectNodeScriptState}.
 * @param pause - The run's current pause at a declared stop.
 * @param capture - The pause's capture.
 * @returns The pause block, or `undefined` without a pause or a capture.
 * @example projectNodePause(pause, capture)?.stopNumber // => 1
 */
export function projectNodePause(
  pause: NodeServerPause | undefined,
  capture: NodeServerCapture | undefined,
) {
  return pause && capture
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
    : undefined
}

/**
 * Builds the arguments a continuation copies for the current pause of a node run, only while it is resumable.
 * @param run - The service's instance and run ids.
 * @param pause - The current pause.
 * @param isResumable - Whether the run is controllable and paused at a declared stop.
 * @returns The `codebook_continue` arguments with `answer: 'next'`, or `undefined`.
 * @example nodeContinueArguments({ instanceId, runId }, pause, true)?.generation // => 3
 */
export function nodeContinueArguments(
  run: { instanceId: string; runId: string },
  pause: NodeServerPause | undefined,
  isResumable: boolean,
) {
  return isResumable && pause
    ? {
        instanceId: run.instanceId,
        runId: run.runId,
        participant: 'server' as const,
        sessionId: pause.sessionId,
        threadId: pause.threadId,
        generation: pause.generation,
        answer: 'next' as const,
      }
    : undefined
}

/**
 * Reads the current pause of a node run's view, its capture and whether the run may be continued now.
 * Called by {@link projectNodeServerState} and {@link projectNodeScriptState}.
 * @param view - The run's view; `undefined` before the run exists.
 * @param state - The projected state word.
 * @param controllable - Whether the service still accepts input for the run.
 * @returns The pause, its capture and `isResumable` (controllable, paused at a declared stop and reading `paused`).
 * @example currentNodePause(view, 'paused', true).isResumable // => true
 */
export function currentNodePause(
  view: { pause?: NodeServerPause; captures: NodeServerCapture[] } | undefined,
  state: string,
  controllable: boolean,
) {
  const pause = view?.pause
  const capture = pause ? view?.captures[pause.captureIndex] : undefined
  return {
    pause,
    capture,
    isResumable: Boolean(controllable && pause && state === 'paused'),
  }
}
