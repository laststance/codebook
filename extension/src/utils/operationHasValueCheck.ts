import type { OperationKind } from '../constants'

/**
 * Tells whether an operation of this kind reads the control's value back after its input (`text` and `choose`), so the run's record starts with `valueCheck: 'pending'`; `click` and `press` have no value to read and start at `'n/a'`.
 *
 * Why it exists: `settleOperation` returns while `valueCheck` is `pending`, so a press recorded as `pending` would stall the run until the progress deadline; one rule keeps the run and the controlled test runtime in step. Called by {@link ConfiguredBrowserRun} when it creates an operation record and by the controlled operations runtime of the tests.
 * @param kind - The operation's kind.
 * @returns `true` for `text` and `choose`; `false` for `click` and `press`.
 * @example
 * operationHasValueCheck('choose') // => true
 * operationHasValueCheck('press') // => false
 */
export function operationHasValueCheck(kind: OperationKind): boolean {
  return kind === 'text' || kind === 'choose'
}
