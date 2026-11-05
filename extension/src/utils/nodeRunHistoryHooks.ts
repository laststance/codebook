import type { NodeProcessRunHooks } from '../nodeProcessRun'
import type { NodeScriptHistorySink } from '../nodeScriptHistorySink'

/**
 * Wires a node run's history to the process core's capture hooks: each captured stop and the spent capture budget are told to the sink, synchronously and without waiting.
 * Called by the node-server run and the node-script run, whose sinks share these two members.
 * @param history - The run's history sink; absent when no history started.
 * @returns The `onStopCaptured` and `onCaptureBudgetExhausted` hooks.
 * @example createNodeRunHistoryHooks(sink).onCaptureBudgetExhausted?.() // tells sink.markCaptureBudgetExhausted()
 */
export function createNodeRunHistoryHooks(
  history:
    | Pick<NodeScriptHistorySink, 'stop' | 'markCaptureBudgetExhausted'>
    | undefined,
): Pick<NodeProcessRunHooks, 'onStopCaptured' | 'onCaptureBudgetExhausted'> {
  return {
    onStopCaptured: (elapsedMs, pause, generation, read) =>
      history?.stop(elapsedMs, pause, generation, read),
    onCaptureBudgetExhausted: () => history?.markCaptureBudgetExhausted(),
  }
}
