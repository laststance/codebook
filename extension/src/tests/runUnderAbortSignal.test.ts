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
