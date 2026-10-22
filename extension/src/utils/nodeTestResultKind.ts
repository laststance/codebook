/** The process facts of a test run's result, as the run record keeps them and the journal's result entry stores them. */
export type NodeTestResultFacts = {
  exitCode: number | null
  signal: string | null
}

/** What a test run's result says, read by the agent as `nodeTest.testResult`. */
export type NodeTestResultKind = 'passed' | 'failed' | 'signal' | 'none'

/**
 * Names what a test run's result says for `nodeTest.testResult`, so the run resource (from the run record's result) and the history resource (from the journal's result entry) give the agent one word for one fact; called by {@link StudyService.state}, {@link NodeTestHistoryStore.list} and {@link describeNodeTestResult}.
 * A result entry exists only for facts that settle the question: a passing exit whose Vitest report showed the cited test, or a non-zero exit or a signal, which never pass ({@link OwnedNodeTestRun.complete}).
 * @param result - The result's process facts; `undefined` when the run recorded no result (yet).
 * @returns
 * - `'none'` without a result, and for an exit that names neither a code nor a signal, which says nothing about the test
 * - `'signal'` when a signal ended the test process
 * - `'passed'` for exit code 0
 * - `'failed'` for any other exit code
 * @example
 * nodeTestResultKind({ exitCode: 0, signal: null })         // => 'passed'
 * nodeTestResultKind({ exitCode: 1, signal: null })         // => 'failed'
 * nodeTestResultKind({ exitCode: null, signal: 'SIGTERM' }) // => 'signal'
 * nodeTestResultKind(undefined)                             // => 'none'
 */
export function nodeTestResultKind(
  result: NodeTestResultFacts | undefined,
): NodeTestResultKind {
  if (!result) return 'none'
  if (result.signal !== null) return 'signal'
  if (result.exitCode === null) return 'none'
  return result.exitCode === 0 ? 'passed' : 'failed'
}
