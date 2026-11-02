import assert from 'node:assert/strict'
import { test } from 'node:test'

import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'

test('deleting a run releases an inspector waiting for a missing DAP response', async () => {
  // Arrange
  const controller = new AbortController()
  const pending = awaitResponse(
    new Promise(() => undefined),
    'stopped stack',
    controller.signal,
  )
  // Act
  controller.abort()
  // Assert
  await assert.rejects(pending, /Cancelled stopped stack/)
})

test('a missing DAP response fails by its deadline and a later response cannot become success', async () => {
  // Arrange
  const response = new Promise<string>((resolve) =>
    setTimeout(() => resolve('late frame'), 15),
  )
  const pending = awaitResponse(response, 'stopped stack', undefined, 5)
  // Act
  await assert.rejects(pending, /Timed out waiting for stopped stack/)
  await response
  // Assert
  await assert.rejects(pending, /Timed out waiting for stopped stack/)
})

test('a response that fails with a look-alike message is told from the deadline by type', async () => {
  // Arrange
  const lookAlike = new Error('Timed out waiting for stopped stack')
  // Act
  const failed = await awaitResponse(
    Promise.reject(lookAlike),
    'stopped stack',
    undefined,
    50,
  ).catch((error: unknown) => error)
  const expired = await awaitResponse(
    new Promise(() => undefined),
    'stopped stack',
    undefined,
    5,
  ).catch((error: unknown) => error)
  // Assert
  assert.equal(failed instanceof WaitTimeoutError, false)
  assert.equal(expired instanceof WaitTimeoutError, true)
})
