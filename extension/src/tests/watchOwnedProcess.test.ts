import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

import { watchOwnedProcess } from '../utils/watchOwnedProcess'

// protects=a waiter on the process's own exit event does not hang when the launch fails to spawn; fails_when=the exit-event promise stays pending after an `error` with no `exit`; no_claim=real executables that start (other tests cover them)
test('a spawn of a missing executable settles the exit event with no code and no signal', async () => {
  // Arrange
  const child = spawn('/nonexistent/codebook-missing-executable', [])
  const watched = watchOwnedProcess(child, {
    startedAt: process.hrtime.bigint(),
    pendingLimitBytes: 1_024,
    overflowMessage: 'overflow',
    failurePrefix: 'failed',
  })

  // Act
  const fact = await Promise.race([
    watched.exitEvent,
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 5_000)),
  ])

  // Assert
  assert.deepEqual(fact, { exitCode: null, signal: null })
  assert.equal(watched.failure()?.message.includes('ENOENT'), true)
  assert.equal(watched.exitFact(), undefined)
})

// protects=a live script is not reported as exited when its child emits a non-spawn error (failed kill, signal or stdio); fails_when=the exit-event promise settles on any error event; no_claim=which Node operation raises the error
test('an error on a live spawned child leaves the exit event pending until the real exit', async () => {
  // Arrange
  const child = spawn(process.execPath, [
    '-e',
    'setTimeout(() => process.exit(7), 400)',
  ])
  const watched = watchOwnedProcess(child, {
    startedAt: process.hrtime.bigint(),
    pendingLimitBytes: 1_024,
    overflowMessage: 'overflow',
    failurePrefix: 'failed',
  })
  await new Promise((resolve) => child.once('spawn', resolve))

  // Act
  child.emit('error', new Error('kill EPERM'))
  const early = await Promise.race([
    watched.exitEvent,
    new Promise<'pending'>((resolve) =>
      setTimeout(() => resolve('pending'), 150),
    ),
  ])
  const fact = await watched.exitEvent

  // Assert
  assert.equal(early, 'pending')
  assert.deepEqual(fact, { exitCode: 7, signal: null })
  assert.equal(watched.exitFact()?.exitCode, 7)
})
