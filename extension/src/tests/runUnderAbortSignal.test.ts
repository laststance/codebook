import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runUnderAbortSignal } from '../utils/runUnderAbortSignal'

// Value: protects=Cycle 0056 task 13, the end of the wait for a step that cannot be cancelled; fails_when=a step that never settles keeps the wait open after the signal fired, a step that settles first loses its result, or a signal that fired before the step still starts it; no_claim=what the step does (host tests); seam=a step the test settles
test('the wait for a step ends with the signal’s reason, a step that settles first gives its result, and a fired signal starts no step', async () => {
  // Arrange
  const fired = new AbortController()
  fired.abort('stopped')
  let startedAfterFiredSignal = false
  const waiting = new AbortController()
  const hanging = runUnderAbortSignal(
    () => new Promise<never>(() => {}),
    waiting.signal,
  )

  // Act
  waiting.abort('bound')
  const hangingEnd = await hanging.then(
    () => 'resolved',
    (reason: unknown) => reason,
  )
  const firstResult = await runUnderAbortSignal(
    async () => 'done',
    new AbortController().signal,
  )
  const firedEnd = await runUnderAbortSignal(async () => {
    startedAfterFiredSignal = true
    return 'started'
  }, fired.signal).then(
    () => 'resolved',
    (reason: unknown) => reason,
  )

  // Assert
  assert.deepEqual(
    { hangingEnd, firstResult, firedEnd, startedAfterFiredSignal },
    {
      hangingEnd: 'bound',
      firstResult: 'done',
      firedEnd: 'stopped',
      startedAfterFiredSignal: false,
    },
  )
})

// Value: protects=Cycle 0056 task 13, a step that fails after the wait ended; fails_when=its late failure is reported as an unhandled rejection that ends the extension host; no_claim=the step's side effects; seam=a step the test fails after the signal
test('a step that fails after the signal ended the wait raises no unhandled rejection', async () => {
  // Arrange
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)
  const controller = new AbortController()
  let failStep = (): void => {}
  const waiting = runUnderAbortSignal(
    () =>
      new Promise<never>((_resolve, reject) => {
        failStep = (): void => reject(new Error('late failure'))
      }),
    controller.signal,
  )
  controller.abort('stopped')
  await waiting.catch(() => undefined)

  // Act
  failStep()
  await new Promise((resolveFlush) => setImmediate(resolveFlush))
  process.off('unhandledRejection', onUnhandled)

  // Assert
  assert.deepEqual(unhandled, [])
})

// Value: protects=Cycle 0056 L2, a Stop pressed in the tick the step settles; fails_when=the step's result wins the race by order alone and the start goes on to launch the agent after Stop; no_claim=a step that settles long after the signal (tests above); seam=a step that fires the signal as it settles
test('a signal that fires in the tick the step settles still ends the wait with its reason', async () => {
  // Arrange
  const stopping = new AbortController()

  // Act
  const end = await runUnderAbortSignal(async () => {
    queueMicrotask(() => stopping.abort('stopped'))
    return 'done'
  }, stopping.signal).then(
    (result) => `resolved with ${result}`,
    (reason: unknown) => reason,
  )

  // Assert
  assert.equal(end, 'stopped')
})

// Value: protects=Cycle 0056 pass 2 T-A, a step that fails on its own before any signal; fails_when=the step's error is replaced by the signal's reason or swallowed; no_claim=a step that fails after the signal (test above); seam=a step that rejects at once
test('a step that fails before the signal fired rethrows its own error', async () => {
  // Arrange
  const signal = new AbortController().signal

  // Act
  const end = await runUnderAbortSignal(async () => {
    throw new Error('the deploy failed')
  }, signal).then(
    () => 'resolved',
    (reason: unknown) => (reason instanceof Error ? reason.message : reason),
  )

  // Assert
  assert.equal(end, 'the deploy failed')
})
