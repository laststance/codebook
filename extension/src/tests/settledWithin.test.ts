import assert from 'node:assert/strict'
import { test } from 'node:test'

import { settledWithin } from '../utils/settledWithin'

test('a write that lands before the bound is waited for', async () => {
  // Arrange
  let landed = false
  const write = Promise.resolve().then(() => {
    landed = true
  })

  // Act
  const settled = await settledWithin(write, 5_000)

  // Assert
  assert.equal(settled, true)
  assert.equal(landed, true)
})

test('a write that never returns releases its waiter at the bound and still lands afterwards', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let finishWrite = (): void => {},
    landed = false
  const write = new Promise<void>((resolve) => {
    finishWrite = resolve
  }).then(() => {
    landed = true
  })
  let outcome: boolean | 'waiting' = 'waiting'
  const waiting = settledWithin(write, 5_000).then((settled) => {
    outcome = settled
  })

  // Act
  context.mock.timers.tick(4_999)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const beforeBound = outcome
  context.mock.timers.tick(1)
  await waiting
  finishWrite()
  await write

  // Assert
  assert.equal(beforeBound, 'waiting')
  assert.equal(outcome, false)
  assert.equal(landed, true)
})

test('a write that fails before the bound reports its own failure', async () => {
  // Arrange
  const write = Promise.reject(new Error('Storage is full'))

  // Act
  const waiting = settledWithin(write, 5_000)

  // Assert
  await assert.rejects(waiting, /Storage is full/)
})

test('no pending write is settled at once', async () => {
  // Act
  const settled = await settledWithin(undefined, 5_000)

  // Assert
  assert.equal(settled, true)
})
