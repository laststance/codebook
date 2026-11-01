import type { ConfiguredOperationRecord } from '../configuredStudySchemas'
import type { OperationRecord } from '../runtime'
import type { RecordedEvent } from '../runtimeSupport/evidence'

/**
 * Turns the run's operation progress into the records a saved study keeps: each operation's final state plus the recording-clock time its input was sent.
 * Called by {@link captureStudy} at every checkpoint of a version 3 run; the time is the journal's own `input.dispatched` receipt, so it is the moment the replay seeks to.
 * @param operations - The run resource's operation records, in declared order.
 * @param events - The run's journal.
 * @returns One record per operation; `atMs` is absent for an operation whose input was never sent.
 * @example
 * projectSavedOperations([{ index: 1, kind: 'click', title: 'Go', state: 'done', ack: 'yes', valueCheck: 'n/a', effect: 'after-verified' }], events)[0]?.atMs // => 1250.5
 */
export function projectSavedOperations(
  operations: readonly OperationRecord[],
  events: readonly RecordedEvent[],
): ConfiguredOperationRecord[] {
  return operations.map((operation) => {
    // The first dispatch receipt of the operation: a repeat of an event never moves the time.
    const dispatched = events.find(
      (event) =>
        event.type === 'input.dispatched' &&
        typeof event.detail === 'object' &&
        event.detail !== null &&
        'operationIndex' in event.detail &&
        event.detail.operationIndex === operation.index,
    )
    return {
      index: operation.index,
      kind: operation.kind,
      title: operation.title,
      ...(dispatched ? { atMs: dispatched.elapsedMs } : {}),
      state: operation.state,
      ack: operation.ack,
      valueCheck: operation.valueCheck,
      effect: operation.effect,
    }
  })
}
