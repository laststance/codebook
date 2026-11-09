import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './utils/configuredRuntimeHarness'

const OPERATION_ACTION = 'repository-operation'
const SUBMIT: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}

/** Copies a value out of the run module's realm so a strict deep comparison accepts it. @example plain(run.view().recordedStops) // [0] */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Counts the `continue` requests the run sent to the debug adapter. @example continueCount(harness) // 1 */
function continueCount(harness: ConfiguredRuntimeHarness): number {
  return harness.commands.filter((command) => command === 'continue').length
}

/**
 * Opens a prepared version 3 browser run with one click operation and one recorded stop, and arranges that js-debug refreshes the stack of that stop's pause while the run saves the stop's evidence.
 * The refresh's `stackTrace` answer is held until `release()` and reports `refreshedLine` as the stop's line.
 * @param context - The test.
 * @param refreshedLine - The line the refreshed stack reports; `undefined` keeps the stop's own line.
 * @example const { harness, release } = await openRunWithRefresh(context, 99)
 */
async function openRunWithRefresh(
  context: TestContext,
  refreshedLine?: number,
) {
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: [SUBMIT],
      stopOperations: [1],
      stopHolds: ['record'],
    },
  })
  await harness.run.prepare()
  const { run } = harness
  const participant = run['participants'].browser
  const session = participant.selected!
  const customRequest = session.customRequest.bind(session)
  let release = (): void => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let isRefreshing = false
  // The refresh's own stack read waits until the test lets it answer.
  session.customRequest = async (command, arguments_) => {
    const answer = await customRequest(command, arguments_)
    if (command !== 'stackTrace' || !isRefreshing) return answer
    await held
    if (refreshedLine === undefined) return answer
    return {
      stackFrames: answer.stackFrames.map((frame: object) => ({
        ...frame,
        line: refreshedLine,
      })),
    }
  }
  const persist = run['persist'].bind(run)
  let didRefresh = false
  // The refresh arrives while the recorded stop's evidence is saved: after its observation is committed, before its resume.
  run['persist'] = async (): Promise<void> => {
    if (!didRefresh && run.view().recordedStops?.length === 1) {
      didRefresh = true
      isRefreshing = true
      run.onEvent(session, {
        type: 'event',
        seq: 9001,
        event: 'continued',
        body: { threadId: 1 },
      })
      run.onEvent(session, {
        type: 'event',
        seq: 9002,
        event: 'stopped',
        body: { threadId: 1, reason: 'breakpoint' },
      })
    }
    await persist()
  }
  return { harness, release, participant }
}

// Value: protects=a recorded stop whose pause js-debug refreshed during the evidence save waits for the refresh to be verified, then resumes that same stop once and the run reaches its after-condition; fails_when=the run resumes while the refresh is pending, or continue() refuses the recorded stop as a stale pause and the whole run fails; no_claim=a real js-debug refresh: the fake session announces continued and stopped and answers the stack read late
test('a recorded stop refreshed during its evidence save resumes once after the refresh is verified and the run completes', async (context) => {
  // Arrange
  const { harness, release, participant } = await openRunWithRefresh(context)
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => participant.refresh?.stage === 'validating',
    'the pending stack refresh',
  )
  // Assert: nothing is resumed and the run has not failed while the refresh is pending.
  assert.equal(continueCount(harness), 0)
  assert.notEqual(harness.run.view().status, 'failed')
  // Act
  release()
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the refreshed recorded stop',
  )
  // Assert
  assert.equal(continueCount(harness), 1)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  assert.deepEqual(plain(harness.run.view().failures), [])
  assert.equal(harness.run.view().operation?.afterVerified, true)
})

// Value: protects=a recorded stop whose refreshed stack shows another place ends the run with the refresh's reason and sends no resume; fails_when=the run continues a pause the refresh no longer certifies; no_claim=a real js-debug refresh
test('a recorded stop whose refresh shows another place ends the run and sends no resume', async (context) => {
  // Arrange
  const { harness, release } = await openRunWithRefresh(context, 99)
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().recordedStops?.length === 1,
    'the recorded stop',
  )
  release()
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the refresh that changed the place',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.match(
    harness.run.view().failures.join('; '),
    /Native stack refresh changed the captured source location/,
  )
  await harness.run.stop()
})

// Value: protects=a recorded stop that is no longer the run's current stop when its pending stack refresh is verified ends the run with the named "pause changed during a stack refresh" reason and sends no resume; fails_when=the guard in awaitRecordedStopRefresh is removed and the run resumes a stale pause; no_claim=a real js-debug refresh: the fake session answers the stack read late and the test advances the run's stop itself
test('a recorded stop that is no longer current after its refresh ends the run with the pause-changed reason and sends no resume', async (context) => {
  // Arrange
  const { harness, release, participant } = await openRunWithRefresh(context)
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => participant.refresh?.stage === 'validating',
    'the pending stack refresh',
  )
  // Act: the run moves past this stop while the refresh is still pending.
  harness.run['stopIndex'] += 1
  release()
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the failure after the stop changed during the refresh',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.match(
    harness.run.view().failures.join('; '),
    /Recorded stop's pause changed during a stack refresh and no resume was sent/,
  )
  await harness.run.stop()
})
