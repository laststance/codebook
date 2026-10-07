import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitForWikiChatAnswer } from '../utils/waitForWikiChatAnswer'

import { createManualClock } from './utils/createManualClock'

/** A sleep on a clock the test moves: it ends at the clock's time or at the abort, and at once for a signal that has already aborted, as the product's sleep does. */
function manualSleep(): {
  clock: ReturnType<typeof createManualClock>
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
} {
  const clock = createManualClock()
  return {
    clock,
    sleep: (delayMs, signal): Promise<void> =>
      new Promise<void>((resolveSleep) => {
        if (signal.aborted) return resolveSleep()
        const timer = clock.setTimeout(resolveSleep, delayMs)
        signal.addEventListener(
          'abort',
          () => {
            clock.clearTimeout(timer)
            resolveSleep()
          },
          { once: true },
        )
      }),
  }
}

/** Lets the wait run until it waits for the clock, the reply or a sign. */
const untilItWaits = (): Promise<void> =>
  new Promise((resolveWait) => setImmediate(resolveWait))

/** A sign that never comes. */
const noSign = (): Promise<void> => new Promise(() => {})

// Value: protects=the case row 3 was written for: a chat command that returns at once with nothing while no chat replies; fails_when=the rule that an empty reply says nothing about the chat is removed, so the returned command ends the wait as an answer and the update watches for 15 minutes; why_new=Cycle 0046 row 150 (no test resolved the command with nothing); seam=the wait's sleep, on a manual clock
test('a chat command that returns at once with nothing is no answer: the wait goes on until the bound and ends there as unanswered', async () => {
  // Arrange
  const { clock, sleep } = manualSleep()
  let outcome = 'still waiting'

  // Act
  const waiting = waitForWikiChatAnswer({
    reply: Promise.resolve(undefined),
    sign: noSign(),
    signal: new AbortController().signal,
    timeoutMs: 30_000,
    sleep,
  }).then((answer) => {
    outcome = answer.outcome
  })
  await untilItWaits()
  clock.advance(29_999)
  await untilItWaits()
  const outcomeBeforeTheBound = outcome
  clock.advance(1)
  await waiting

  // Assert
  assert.equal(outcomeBeforeTheBound, 'still waiting')
  assert.equal(outcome, 'unanswered')
})

// Value: protects=the difference between a chat that finished its reply and one that works on the request; fails_when=a reply that says the response is complete is taken for a chat that works (it is then watched for 15 minutes), or a reply that waits for a confirmation is taken for a finished one (the update then ends while the chat waits for the learner); why_new=Cycle 0046 row 149; seam=none
test('a reply that waits for a confirmation means the chat works on the request, and a reply without one means its response is complete', async () => {
  // Arrange
  const { sleep } = manualSleep()
  const wait = (reply: unknown): ReturnType<typeof waitForWikiChatAnswer> =>
    waitForWikiChatAnswer({
      reply: Promise.resolve(reply),
      sign: noSign(),
      signal: new AbortController().signal,
      timeoutMs: 30_000,
      sleep,
    })

  // Act
  const waitingForApproval = await wait({
    type: 'confirmation',
    kind: 'toolInvocation',
    toolId: 'copilot_runInTerminal',
  })
  const complete = await wait({ metadata: { modelMessageId: 'a1' } })
  const empty = await wait({})

  // Assert
  assert.deepEqual(waitingForApproval, { outcome: 'working' })
  assert.deepEqual(complete, { outcome: 'replied' })
  assert.deepEqual(empty, { outcome: 'replied' })
})

// Value: protects=the chat's own message when it answers an update request with an error; fails_when=the error reply is reported as a chat that did not answer, or its message is dropped; why_new=Cycle 0046 row 148; seam=none
test('a reply that reports an error is an error reply with the chat’s message, also when it waits for nothing and names no message', async () => {
  // Arrange
  const { sleep } = manualSleep()
  const wait = (reply: unknown): ReturnType<typeof waitForWikiChatAnswer> =>
    waitForWikiChatAnswer({
      reply: Promise.resolve(reply),
      sign: noSign(),
      signal: new AbortController().signal,
      timeoutMs: 30_000,
      sleep,
    })

  // Act
  const named = await wait({
    errorDetails: { message: 'You have exceeded your quota.' },
  })
  const unnamed = await wait({ errorDetails: {} })

  // Assert
  assert.deepEqual(named, {
    outcome: 'error-reply',
    message: 'You have exceeded your quota.',
  })
  assert.deepEqual(unnamed, { outcome: 'error-reply', message: undefined })
})

test('a chat command that throws ends the wait as failed with what it threw', async () => {
  // Arrange
  const { sleep } = manualSleep()
  const thrown = new Error('Chat is unavailable')

  // Act
  const answer = await waitForWikiChatAnswer({
    reply: Promise.reject(thrown),
    sign: noSign(),
    signal: new AbortController().signal,
    timeoutMs: 30_000,
    sleep,
  })

  // Assert
  assert.deepEqual(answer, { outcome: 'failed', error: thrown })
})

test('a sign of the update ends the wait as a chat that works, while the chat command is still pending', async () => {
  // Arrange
  const { sleep } = manualSleep()
  let reportSign = (): void => {}
  const sign = new Promise<void>((resolveSign) => {
    reportSign = resolveSign
  })

  // Act
  const waiting = waitForWikiChatAnswer({
    reply: new Promise(() => {}),
    sign,
    signal: new AbortController().signal,
    timeoutMs: 30_000,
    sleep,
  })
  await untilItWaits()
  reportSign()
  const answer = await waiting

  // Assert
  assert.deepEqual(answer, { outcome: 'working' })
})

test('an abort ends the wait as cancelled, not as a chat that did not answer', async () => {
  // Arrange
  const { sleep } = manualSleep()
  const closing = new AbortController()

  // Act
  const waiting = waitForWikiChatAnswer({
    reply: new Promise(() => {}),
    sign: noSign(),
    signal: closing.signal,
    timeoutMs: 30_000,
    sleep,
  })
  await untilItWaits()
  closing.abort()
  const answer = await waiting

  // Assert
  assert.deepEqual(answer, { outcome: 'cancelled' })
})

test('a pending chat command without a sign is unanswered at the bound and not one millisecond before it', async () => {
  // Arrange
  const { clock, sleep } = manualSleep()
  let outcome = 'still waiting'

  // Act
  const waiting = waitForWikiChatAnswer({
    reply: new Promise(() => {}),
    sign: noSign(),
    signal: new AbortController().signal,
    timeoutMs: 30_000,
    sleep,
  }).then((answer) => {
    outcome = answer.outcome
  })
  await untilItWaits()
  clock.advance(29_999)
  await untilItWaits()
  const outcomeBeforeTheBound = outcome
  clock.advance(1)
  await waiting

  // Assert
  assert.equal(outcomeBeforeTheBound, 'still waiting')
  assert.equal(outcome, 'unanswered')
})
