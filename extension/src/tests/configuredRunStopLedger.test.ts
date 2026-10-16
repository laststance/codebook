import assert from 'node:assert/strict'
import { test } from 'node:test'

import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

const pauseReady = async (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
  name: 'server' | 'browser',
) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants[name]?.snapshot
  }, `${name} committed stop`)

// Value: protects=the chat's keyboard at the first stop of an AI-driven input (task 5); fails_when=the configured run opens no causal window when it accepts its input, so its own first stop is judged the learner's and the reader hands the keyboard to the paused file; why_new=Cycle 0046 decision R7 (the window opens at action acceptance)
test("the stop the run's input causes is recorded as Codebook's", async (context) => {
  // Arrange
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()

  // Act
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')

  // Assert
  assert.equal(
    codebookStopLedger.isCodebookCausedStop(harness.sessions.server.id),
    true,
  )
})

// Value: protects=the learner's next stop after the run's own stop; fails_when=the window the input opened stays open after the run accepted its stop, so a later stop of that session that no request announced is judged the run's; why_new=Cycle 0046 decision R7 (the window closes at the next accepted stop)
test("the run's accepted stop closes its causal window", async (context) => {
  // Arrange
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()

  // Act
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')

  // Assert
  assert.equal(
    codebookStopLedger.isWindowOpen(harness.sessions.server.id),
    false,
  )
})

// Value: protects=the chat's keyboard at the stop a codebook_continue reaches; fails_when=the continuation opens no window for its next declared stop, so that stop is judged the learner's; why_new=Cycle 0046 decision R7 (the window opens at continueCommittedPause)
test("the stop the run's continuation reaches is recorded as Codebook's", async (context) => {
  // Arrange
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')

  // Act
  await harness.run.continue('server', server.pause)
  await pauseReady(harness, 'browser')

  // Assert
  assert.equal(
    codebookStopLedger.isCodebookCausedStop(harness.sessions.browser.id),
    true,
  )
})

// Value: protects=the keyboard of a learner whose palette command made js-debug refresh the stack of the run's pause; fails_when=the refreshed stop keeps the verdict of the run's own stop, so the paused file never gets the keyboard; why_new=Cycle 0046 finding 589, C54 round 9f (continued, then stopped, with no request; the run records dap.pause-refresh-pending)
test("an adapter refresh of the run's pause is recorded as no stop of Codebook's", async (context) => {
  // Arrange
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')

  // Act: js-debug refreshes its presentation without a client request.
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 910,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 911,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })

  // Assert
  assert.equal(
    codebookStopLedger.isCodebookCausedStop(harness.sessions.server.id),
    false,
  )
})

// Value: protects=the keyboard of a learner who steps while the run's input is in flight; fails_when=a resume the run did not make leaves the causal window open, so the learner's stop is judged the run's; why_new=Cycle 0046 decision R7 (the window closes at the gate invalidation of an unreserved resume in onRequest)
test("a resume the run did not make closes the run's causal window", async (context) => {
  // Arrange: the run accepted its input, so the window of the server's stop is open.
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  assert.equal(
    codebookStopLedger.isWindowOpen(harness.sessions.server.id),
    true,
  )

  // Act: the learner's Step Into reaches the server's adapter.
  harness.run.onRequest(harness.sessions.server, {
    type: 'request',
    seq: 955,
    command: 'stepIn',
    arguments: { threadId: 1 },
  })

  // Assert
  assert.equal(
    codebookStopLedger.isWindowOpen(harness.sessions.server.id),
    false,
  )
})

// Value: protects=the keyboard of a learner who pauses the program while the run's input is in flight; fails_when=a learner's pause request leaves the causal window open, so the stop it makes is judged the run's; why_new=Cycle 0046 decision R7 (a learner's pause request is no resume the run made)
test("a learner's pause request closes the run's causal window", async (context) => {
  // Arrange: the run accepted its input, so the window of the server's stop is open.
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')

  // Act
  harness.run.onRequest(harness.sessions.server, {
    type: 'request',
    seq: 956,
    command: 'pause',
    arguments: { threadId: 1 },
  })

  // Assert
  assert.equal(
    codebookStopLedger.isWindowOpen(harness.sessions.server.id),
    false,
  )
})

// Value: protects=the keyboard at a stop held after the run ended; fails_when=the ended run's verdicts stay in the ledger, so a later stop of a reused session is judged Codebook's; why_new=Cycle 0046 decision R7 (the window closes at cleanup; a held stop stays caused only while its viewport exists)
test("the run's cleanup forgets the verdicts of its sessions", async (context) => {
  // Arrange
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')

  // Act
  await harness.run.stop()

  // Assert
  assert.equal(
    codebookStopLedger.isCodebookCausedStop(harness.sessions.server.id),
    false,
  )
})

// Value: protects=the keyboard at a stop that follows the run's failure; fails_when=a failed run leaves its causal window open until its cleanup runs, so a stop read meanwhile is judged the run's; why_new=Cycle 0046 decision R7 (the window closes when the run fails)
test('a failed run closes its causal windows', async (context) => {
  // Arrange: the run accepted its input, so the window of the server's stop is open.
  codebookStopLedger.reset()
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')

  // Act
  harness.run.fail('Sources changed during the run')

  // Assert
  assert.equal(
    codebookStopLedger.isWindowOpen(harness.sessions.server.id),
    false,
  )
  await harness.run.stop()
})
