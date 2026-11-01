import type { OperationFailure, OperationRecord } from '../runtime'

/** The short reason after "Stopped at operation <k>" for each code an operation can fail with. */
const SHORT_REASONS: Readonly<Record<string, string>> = {
  OPTION_NOT_AVAILABLE: 'option not available',
  INPUT_NOT_ACCEPTED: 'input not accepted',
  CONTROL_KIND_NOT_SUPPORTED: 'control not supported',
  SECRET_INPUT_FROM_CHAT: 'secret refused from chat',
  SECRET_INPUT_VISIBLE: 'secret choice refused',
  SECRET_BECAME_VISIBLE: 'secret became visible',
  NAVIGATION_BEFORE_LAST_OPERATION: 'page navigated early',
  NAVIGATION_NOT_SETTLED: 'page did not settle',
  OPERATION_AFTER_NOT_MET: 'result not confirmed',
  RUN_FAILED_UNEXPECTEDLY: 'failed unexpectedly',
}

/**
 * Words where and why a run stopped.
 * @param failure - The coded failure, if the run has one.
 * @param unfinishedIndex - The first operation that is not done, which a run stopped without a failure names.
 * @returns `Stopped at operation <k> · <reason>`.
 * @example stoppedText(undefined, 3) // => 'Stopped at operation 3 · stopped'
 */
function stoppedText(
  failure: Pick<OperationFailure, 'code' | 'operationIndex'> | undefined,
  unfinishedIndex: number,
): string {
  const reason = failure
    ? (SHORT_REASONS[failure.code] ?? 'run failed')
    : 'stopped'
  return `Stopped at operation ${failure?.operationIndex ?? unfinishedIndex} · ${reason}`
}

/**
 * Words the progress of a version 3 run for the status item, the live strip and the run resource the chat reads (DES-5): which operation is in flight and in what state, when every operation was sent, when the run is done, or where and why it stopped.
 * Never a bare `4/4` as success: "sent" is not "done", and only a verified result reads `Done`.
 * Called by {@link StudyWorkspace} for the status bar and by {@link StudyService} for the run resource.
 * @param operations - The run's operation records in declared order; none for a run of versions 1 and 2.
 * @param runState - The run's state word (`failed`, `stopped`, `completed`, or a live one).
 * @param failure - The run's first operation failure, if any.
 * @returns
 * - `Operation <k>/<m> · <title> · sending` or `… · paused in code` for the operation in flight
 * - `<m>/<m> sent · checking result` once the last input was acknowledged and its value checked
 * - `Done · <m> operations` when every operation is done
 * - `Stopped at operation <k> · <reason>` when the run failed or was stopped before that
 * - `undefined` for a run without operations and between two operations
 * @example
 * describeOperationStatus(records, 'acting', undefined) // => 'Operation 2/4 · Enter amount · sending'
 * describeOperationStatus(records, 'failed', { code: 'OPERATION_AFTER_NOT_MET', operationIndex: 4 }) // => 'Stopped at operation 4 · result not confirmed'
 */
export function describeOperationStatus(
  operations: readonly OperationRecord[] | undefined,
  runState: string | undefined,
  failure: Pick<OperationFailure, 'code' | 'operationIndex'> | undefined,
): string | undefined {
  if (!operations?.length) return undefined
  const total = operations.length
  const unfinished = operations.find((operation) => operation.state !== 'done')
  // A failed run never reads Done: a final save that failed after every operation was done still names the last operation and why.
  if (failure || runState === 'failed')
    return stoppedText(failure, unfinished?.index ?? total)
  if (!unfinished)
    return `Done · ${total} ${total === 1 ? 'operation' : 'operations'}`
  // A run stopped before its end names where it stopped.
  if (runState === 'stopped') return stoppedText(failure, unfinished.index)
  const isLast = unfinished.index === total
  // Everything was sent and acknowledged; only the page's result is still being checked.
  if (
    isLast &&
    (unfinished.state === 'sending' || runState === 'resuming') &&
    unfinished.ack === 'yes' &&
    unfinished.valueCheck !== 'pending'
  )
    return `${total}/${total} sent · checking result`
  if (unfinished.state === 'sending' || unfinished.state === 'paused')
    return `Operation ${unfinished.index}/${total} · ${unfinished.title} · ${unfinished.state === 'sending' ? 'sending' : 'paused in code'}`
  return undefined
}
