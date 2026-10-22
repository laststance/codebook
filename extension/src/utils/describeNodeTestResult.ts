import {
  nodeTestResultKind,
  type NodeTestResultFacts,
} from './nodeTestResultKind'

/** The learner's words for a test run's result, one of the four forms of the String catalog. */
export type NodeTestVerdict =
  | 'Test passed · exit code 0'
  | `Test failed · exit code ${number}`
  | `Ended by signal ${string}`
  | 'No result recorded'

/**
 * Words a test run's result for the learner, so the status item's tooltips, the partial-save notification, Saved studies rows, the `HISTORY_SEAL_FAILED` message, the Application pane's last line at the result and the Study section's status and Result locator say the same thing about one result; called by {@link NodeTestHistoryStore} (a summary's verdict, which {@link describeNodeLearningSave} and {@link NodeLearningSave} carry), {@link StudyService}, {@link projectNodeTestApplication} and {@link projectNodeTestSection}.
 * @param result - The result's process facts; `undefined` when the run recorded no result.
 * @returns
 * - `'Test passed · exit code 0'` for a passing exit
 * - `'Test failed · exit code <n>'` for another exit code
 * - `'Ended by signal <SIGNAL>'` when a signal ended the process
 * - `'No result recorded'` without a result, and for an exit that names neither a code nor a signal ({@link nodeTestResultKind})
 * @example
 * describeNodeTestResult({ exitCode: 0, signal: null })         // => 'Test passed · exit code 0'
 * describeNodeTestResult({ exitCode: 1, signal: null })         // => 'Test failed · exit code 1'
 * describeNodeTestResult({ exitCode: null, signal: 'SIGKILL' }) // => 'Ended by signal SIGKILL'
 * describeNodeTestResult(undefined)                             // => 'No result recorded'
 */
export function describeNodeTestResult(
  result: NodeTestResultFacts | undefined,
): NodeTestVerdict {
  const kind = nodeTestResultKind(result)
  if (kind === 'signal' && result?.signal)
    return `Ended by signal ${result.signal}`
  if (kind === 'passed') return 'Test passed · exit code 0'
  if (kind === 'failed' && typeof result?.exitCode === 'number')
    return `Test failed · exit code ${result.exitCode}`
  return 'No result recorded'
}
