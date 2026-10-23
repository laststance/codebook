import assert from 'node:assert/strict'

import { within } from './within'

/** How long an act that must not wait on a named pipe may take before a test reads it as held there: a read that waits on a pipe nobody writes never returns, and a loaded machine can take seconds for the work around it (Cycle 0049 F112). */
export const AT_ONCE_BOUND_MS = 10_000

/**
 * Awaits an act that a defect would hold on a named pipe for ever, and fails the test in its assertion when the act has not answered within {@link AT_ONCE_BOUND_MS}.
 * Why: these tests used the runner's limit of 2 s for the whole test, so the folder, pipe and fixture they build first counted against "at once" and a loaded machine stopped them at the limit although the act answered (Cycle 0049 F112 and its family); only the act is bounded here, by a bound a held read never meets.
 * Called by the named-pipe tests of the Wiki reader, the Wiki update's start, the marker claim, the recorded owner and the Cursor MCP catalog.
 * @param act - The read, check or start under test.
 * @param what - Names the act in the failure.
 * @returns What the act answered.
 * @throws An assertion error naming `what` when the act was still waiting at the bound.
 * @example const block = await answeredAtOnce(findWikiUpdateStartBlock(output, root), 'the start check') // => { cause: 'special-file', paths: ['index.html'] }
 */
export async function answeredAtOnce<Value>(
  act: Promise<Value>,
  what: string,
): Promise<Value> {
  const answer = await within(act, AT_ONCE_BOUND_MS)
  // A held read answers nothing within the bound; anything else is the act's own answer.
  if (answer === 'still waiting')
    assert.fail(`${what} waited on the named pipe for ${AT_ONCE_BOUND_MS} ms`)
  return answer
}
