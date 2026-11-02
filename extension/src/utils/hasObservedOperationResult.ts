import { ENTRY_LOAD_OPERATION_KEY } from '../constants'

/**
 * Says whether an aggregate operation record stands for an observed, verified result a learning summary or terminal reference may cite.
 *
 * Why it exists: a run that declares no operation (entry-render stops only) dispatches no input, so its synthetic `entry-load` record never has `inputAcknowledged`; its result stands on the entry page's continue evidence instead. Called by `StudyService.state()`, `StudyService.explain()` and `validateConfiguredStudyEvidence()`.
 * @param operation - The run's or the saved study's aggregate operation record, if any.
 * @returns `true` when the after condition was verified and either the input was acknowledged or the record is the synthetic entry-load record (no input dispatched) with its continued pause.
 * @example hasObservedOperationResult({ key: 'entry-load', inputDispatched: false, inputAcknowledged: false, afterVerified: true, continuedPause }) // => true
 */
export function hasObservedOperationResult(
  operation:
    | {
        key: string
        inputDispatched: boolean
        inputAcknowledged: boolean
        afterVerified: boolean
        continuedPause?: unknown
      }
    | undefined,
): boolean {
  if (!operation?.afterVerified) return false
  // A real operation needs its acknowledged input; the entry-load record, which dispatches none, needs its continuation instead.
  return (
    operation.inputAcknowledged ||
    (operation.key === ENTRY_LOAD_OPERATION_KEY &&
      !operation.inputDispatched &&
      operation.continuedPause !== undefined)
  )
}
