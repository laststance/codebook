import type { OperationFailure } from '../runtime'

/**
 * Words the structured fields an agent reads on the error of a failed operation: the run, the operation, the configuration path to fix, whether anything was sent, the side effects it may have had, a retry rule and the id of the Output > Codebook line (DX-5).
 * Called by the service when it describes a version 3 run's failure ({@link StudyService.runtimeFailureError}).
 * @param failure - The run's first operation failure.
 * @param runUri - The run's resource address, when the caller has it.
 * @returns The fields; `retry` is "fix the configuration, then one new run" when nothing of the run reached the page (not sent and no side effects), and "never retry automatically; ask the learner" once the input of this or an earlier operation was sent.
 * @example
 * describeOperationFailureDetails({ code: 'OPTION_NOT_AVAILABLE', operationIndex: 1, path: 'operations[0].value', sent: 'not-sent', sideEffects: 'none', logId: 'r1#1' }, 'codebook://run/r1')
 * // => { runUri: 'codebook://run/r1', operationIndex: 1, path: 'operations[0].value', sent: 'not-sent', sideEffects: 'none', retry: 'Fix the configuration, then start one new run.', logId: 'r1#1' }
 */
export function describeOperationFailureDetails(
  failure: OperationFailure,
  runUri?: string,
): Record<string, unknown> {
  return {
    ...(runUri === undefined ? {} : { runUri }),
    operationIndex: failure.operationIndex,
    ...(failure.path === undefined ? {} : { path: failure.path }),
    sent: failure.sent,
    sideEffects: failure.sideEffects,
    retry:
      failure.sent === 'not-sent' && failure.sideEffects === 'none'
        ? 'Fix the configuration, then start one new run.'
        : 'Never retry automatically; ask the learner.',
    logId: failure.logId,
  }
}
