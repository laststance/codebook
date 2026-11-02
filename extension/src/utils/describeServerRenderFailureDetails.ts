import type { OperationFailure } from '../runtime'

import { describeOperationFailureDetails } from './describeOperationFailureDetails'

/**
 * Words the structured `details` of `SERVER_STOP_NOT_REACHED` and `ENTRY_LOAD_TIMEOUT` an agent reads on the error of a failed server-render run.
 *
 * Why it exists: the two codes carry fields the operation codes do not (the stop, the paused and the unreached stops, the entry route), and an entry-render failure has no operation to name. Called by {@link StudyService.runtimeFailureError} when the failure text leads with one of the two codes.
 * @param failure - The run's first failure with its `serverRender` or `entryLoad` fields.
 * @param runUri - The run's resource address, when the caller has it.
 * @returns
 * - For `SERVER_STOP_NOT_REACHED`: `phase`, `stop`, `operationIndex` (after-operation only), `pausedStops`, `notReachedStops`, `firstExecutionObserved: false`, plus the operation fields (`sent`, `sideEffects`, `retry`, `logId`, `runUri`)
 * - For `ENTRY_LOAD_TIMEOUT`: `entryRoute`, `lastPausedStop`, `elapsedMs` and the operation fields
 * - Only the operation fields when neither group is present
 * @example
 * describeServerRenderFailureDetails({ code: 'ENTRY_LOAD_TIMEOUT', operationIndex: 0, sent: 'not-sent', sideEffects: 'none', logId: 'r1#start', entryLoad: { entryRoute: '/dashboard', lastPausedStop: 'app/lib/data.ts:91', elapsedMs: 20012 } })
 * // => { entryRoute: '/dashboard', lastPausedStop: 'app/lib/data.ts:91', elapsedMs: 20012, sent: 'not-sent', sideEffects: 'none', retry: 'Fix the configuration, then start one new run.', logId: 'r1#start' }
 */
export function describeServerRenderFailureDetails(
  failure: OperationFailure,
  runUri?: string,
): Record<string, unknown> {
  const { operationIndex: _operationIndex, ...operationFields } =
    describeOperationFailureDetails(failure, runUri)
  if (failure.serverRender) {
    const { phase, stop, pausedStops, notReachedStops } = failure.serverRender
    return {
      phase,
      stop,
      // The entry render is a phase of its own, never an operation 0.
      ...(phase === 'after-operation'
        ? { operationIndex: failure.operationIndex }
        : {}),
      pausedStops,
      notReachedStops,
      firstExecutionObserved: false,
      ...operationFields,
    }
  }
  if (failure.entryLoad) return { ...failure.entryLoad, ...operationFields }
  return operationFields
}
